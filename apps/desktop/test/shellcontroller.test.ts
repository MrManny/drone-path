import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG, settingsPatchOf } from 'drone-path-engine/config';
import { parsePickRequest } from '../src/appsession.js';
import type { AppSession, PickResult } from '../src/appsession.js';
import { emptyAppState } from '../src/appstate.js';
import type { AppState } from '../src/appstate.js';
import { createShellController } from '../src/shellcontroller.js';
import type { AppStateStore, ExportRunnerPort, ShellWindow } from '../src/shellcontroller.js';

function makeStore(initial: AppState = emptyAppState()): {
  store: AppStateStore;
  readSpy: ReturnType<typeof vi.fn>;
  writeSpy: ReturnType<typeof vi.fn>;
  saveSafelySpy: ReturnType<typeof vi.fn>;
  current: () => AppState;
} {
  let state = initial;
  const readSpy = vi.fn(() => state);
  const writeSpy = vi.fn((next: AppState) => {
    state = next;
  });
  const saveSafelySpy = vi.fn((next: AppState) => {
    state = next;
  });
  return {
    store: { read: readSpy, write: writeSpy, saveSafely: saveSafelySpy },
    readSpy,
    writeSpy,
    saveSafelySpy,
    current: () => state,
  };
}

function makeController(overrides: {
  appState?: AppState;
  stateStore?: AppStateStore;
  dirExists?: (dir: string) => boolean;
  systemLanguages?: string[];
} = {}) {
  const { store } = makeStore(overrides.appState);
  const log = vi.fn();
  const quitApp = vi.fn();
  const controller = createShellController({
    config: DEFAULT_CONFIG,
    appState: overrides.appState,
    stateStore: overrides.stateStore ?? store,
    systemLanguages: overrides.systemLanguages ?? ['en-US'],
    dirExists: overrides.dirExists ?? (() => true),
    confirmStopExport: async () => false,
    quitApp,
    log,
  });
  return { controller, log, quitApp };
}

describe('createShellController settings and language persistence', () => {
  it('applies valid settings immediately and persists best-effort', () => {
    const { store, saveSafelySpy } = makeStore();
    saveSafelySpy.mockImplementation(() => {
      // Simulate best-effort persistence absorbing a disk failure internally.
    });
    const { controller } = makeController({ stateStore: store });
    const patch = { ...settingsPatchOf(DEFAULT_CONFIG), style: 'topo' as const, zoom: 15 };

    controller.ipc.saveSettings(patch);

    expect(controller.getConfig().style).toBe('topo');
    expect(controller.ipc.getSettings().zoom).toBe(15);
    expect(saveSafelySpy).toHaveBeenCalledWith(expect.objectContaining({ settings: patch }));
  });

  it('rejects invalid settings without modifying config or persisting', () => {
    const { store, saveSafelySpy } = makeStore();
    const { controller } = makeController({ stateStore: store });

    expect(() => controller.ipc.saveSettings({ style: 'bogus' })).toThrow();
    expect(controller.getConfig()).toEqual(DEFAULT_CONFIG);
    expect(saveSafelySpy).not.toHaveBeenCalled();
  });

  it('keeps the previous language preference when strict persistence fails', () => {
    const { store, writeSpy } = makeStore({ ...emptyAppState(), language: 'de' });
    writeSpy.mockImplementationOnce(() => {
      throw new Error('cannot write app state');
    });
    const { controller } = makeController({
      appState: { ...emptyAppState(), language: 'de' },
      stateStore: store,
    });

    expect(() => controller.ipc.saveLanguage('fr')).toThrow('cannot write app state');
    expect(controller.ipc.getLanguage()).toEqual({ preference: 'de', locale: 'de' });
  });

  it('rejects unsupported locales before writing state', () => {
    const { store, writeSpy } = makeStore();
    const { controller } = makeController({ stateStore: store });

    expect(() => controller.ipc.saveLanguage('und')).toThrow('invalid app language');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('persists remembered open dir only when the directory still exists', () => {
    const { store, saveSafelySpy } = makeStore();
    let exists = true;
    const { controller } = makeController({ stateStore: store, dirExists: () => exists });
    const video = path.resolve('clips', 'flight.mp4');

    controller.rememberPickedFile(video);
    expect(saveSafelySpy).toHaveBeenCalledWith(
      expect.objectContaining({ lastOpenDir: path.dirname(video) }),
    );
    expect(controller.rememberedOpenDir()).toBe(path.dirname(video));

    exists = false;
    expect(controller.rememberedOpenDir()).toBeUndefined();
  });
});

describe('createShellController IPC coordination and update state', () => {
  it('clears pending output approvals after a successful recording pick', async () => {
    const { controller } = makeController();
    const video = path.resolve('clips', 'flight.mp4');
    const out = path.resolve('clips', 'out', 'flight_map.mp4');
    const session: AppSession = {
      pick: vi.fn(async (): Promise<PickResult> => ({ ok: true })),
      openFile: vi.fn(async (): Promise<PickResult> => ({ ok: true })),
      getSession: () => null,
      videoPath: () => video,
      saveTrack: vi.fn(),
    };
    const runner: ExportRunnerPort = {
      start: vi.fn(),
      cancel: vi.fn(),
      running: () => false,
    };
    controller.attachSession(session);
    controller.attachExportRunner(runner);

    controller.ipc.approveExportOut(out);
    await controller.ipc.pickRecording({ settings: settingsPatchOf(DEFAULT_CONFIG) });

    expect(() => controller.ipc.startExport({ outPath: out, config: {} })).toThrow(
      'output path was not approved by save dialog',
    );
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('tracks update readiness and forwards restart failures to the live window', () => {
    const { controller } = makeController();
    expect(controller.ipc.getUpdateState()).toEqual({ ready: false });
    expect(controller.ipc.restartUpdate()).toEqual({
      ok: false,
      code: 'UPDATES_UNAVAILABLE',
      detail: 'this build does not self-update',
    });

    const sent: Array<{ channel: string; payload: unknown }> = [];
    const win: ShellWindow = {
      on: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn(),
      webContents: {
        send: (channel, payload) => sent.push({ channel, payload }),
      },
    };
    controller.setWindow(win);
    controller.markUpdateReady();
    expect(controller.ipc.getUpdateState()).toEqual({ ready: true });

    controller.attachUpdates({
      restart: ({ onError }) => {
        onError({ code: 'UPDATE_RESTART_FAILED', detail: 'installer failed' });
        return { ok: true };
      },
    });
    expect(controller.ipc.restartUpdate()).toEqual({ ok: true });
    expect(sent).toEqual([
      {
        channel: 'dronepath:update:restart-failed',
        payload: { code: 'UPDATE_RESTART_FAILED', detail: 'installer failed' },
      },
    ]);
  });

  it('opens archive clips via session.openFile, clears pending outputs, and reports offline clips', async () => {
    const { controller } = makeController();
    const video = path.resolve('clips', 'flight.mp4');
    const out = path.resolve('clips', 'out', 'flight_map.mp4');
    const session: AppSession = {
      pick: vi.fn(async (): Promise<PickResult> => ({ ok: true })),
      openFile: vi.fn(async (): Promise<PickResult> => ({ ok: true })),
      getSession: () => null,
      videoPath: () => video,
      saveTrack: vi.fn(),
    };
    const runner: ExportRunnerPort = {
      start: vi.fn(),
      cancel: vi.fn(),
      running: () => false,
    };
    let exists = true;
    controller.attachSession(session);
    controller.attachExportRunner(runner);
    controller.attachArchiveService({
      listRoots: () => [],
      addRoot: () => [],
      removeRoot: () => [],
      scan: async () => ({ scanned: 0 }),
      cancelScan: () => {},
      query: () => ({ flights: [], totalCount: 0, offlineCount: 0 }),
      findAtPoint: () => [],
      fileExists: () => exists,
    });

    controller.ipc.approveExportOut(out);
    await expect(
      controller.ipc.openArchiveClip({
        path: video,
        settings: settingsPatchOf(DEFAULT_CONFIG),
        seekSec: 5,
      }),
    ).resolves.toEqual({ ok: true });
    expect(session.openFile).toHaveBeenCalledWith(
      video,
      parsePickRequest({ settings: settingsPatchOf(DEFAULT_CONFIG) }),
    );
    expect(() => controller.ipc.startExport({ outPath: out, config: {} })).toThrow(
      'output path was not approved by save dialog',
    );

    exists = false;
    await expect(
      controller.ipc.openArchiveClip({
        path: video,
        settings: settingsPatchOf(DEFAULT_CONFIG),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'ARCHIVE_CLIP_OFFLINE',
      detail: `recording is offline or missing: ${video}`,
      params: { name: 'flight.mp4' },
    });
  });
});
