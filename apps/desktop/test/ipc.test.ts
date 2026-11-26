import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { registerIpcHandlers } from '../app/ipc.mjs';
import { appStateFile } from '../src/apppaths.js';
import { parsePickRequest } from '../src/appsession.js';
import type { AppSession } from '../src/appsession.js';
import type { AppState } from '../src/appstate.js';
import { emptyAppState } from '../src/appstate.js';
import { APP_ORIGIN } from '../shared/appurls.js';
import type { Locale } from '../shared/desktop-i18n/loader.js';
import type {
  AppBridge,
  IpcEventChannel,
  IpcEventSender,
  IpcHandlerMap,
  IpcInvokeChannel,
  PickResult,
} from '../shared/ipc.js';
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '../shared/ipc.js';
import { DEFAULT_CONFIG, settingsPatchOf } from 'drone-path-engine/config';
import type { ExportRequest, RenderConfig } from 'drone-path-engine/config';
import { createShellController } from '../src/shellcontroller.js';
import type { ExportRunnerPort, ShellController, ShellWindow } from '../src/shellcontroller.js';
import { createAppStateStore, readAppState } from '../src/shellio.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, handler: Handler): void => {
        handlers.set(channel, handler);
      },
    },
    dialog: {
      showSaveDialog: vi.fn(),
      showOpenDialog: vi.fn(),
      showMessageBox: vi.fn(),
    },
    shell: {
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  ipcMain: harness.ipcMain,
  dialog: harness.dialog,
  shell: harness.shell,
}));

function makeController(options: {
  video?: string | null;
  config?: Partial<RenderConfig>;
  appState?: AppState;
  win?: ShellWindow | null;
} = {}): {
  controller: ShellController;
  session: AppSession;
  exportRunner: ExportRunnerPort;
} {
  const video =
    options.video === undefined ? path.join(tmpDir(), 'flight.mp4') : options.video;
  const log = vi.fn();
  const controller = createShellController({
    config: { ...DEFAULT_CONFIG, ...options.config },
    appState: options.appState ?? emptyAppState(),
    stateStore: createAppStateStore(appStateFile, log),
    systemLanguages: ['en-US'],
    dirExists: (dirPath) => fs.existsSync(dirPath),
    confirmStopExport: async () => false,
    quitApp: vi.fn(),
    log,
  });
  const session: AppSession = {
    pick: vi.fn(async (): Promise<PickResult> => ({ ok: true })),
    openFile: vi.fn(async (): Promise<PickResult> => ({ ok: true })),
    getSession: vi.fn(() => null),
    videoPath: () => video,
    saveTrack: vi.fn(() => {}),
  };
  const exportRunner: ExportRunnerPort = {
    start: vi.fn((_video: string, _request: ExportRequest) => {}),
    cancel: vi.fn(() => {}),
    running: vi.fn(() => false),
  };
  controller.attachSession(session);
  controller.attachExportRunner(exportRunner);
  controller.setWindow(options.win ?? null);
  return { controller, session, exportRunner };
}

function setup(controller: ShellController, log = vi.fn()): void {
  registerIpcHandlers(controller.ipc, { devUrl: null, log });
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = harness.handlers.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return handler({ senderFrame: { url: `${APP_ORIGIN}/index.html` } }, ...args) as Promise<unknown>;
}

function writeFile(filePath: string): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'existing');
  return filePath;
}

beforeEach(() => {
  harness.handlers.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTmpDirs();
});

describe('IPC sender trust and query channels', () => {
  it('checks devUrl by origin rather than raw prefix', async () => {
    const { controller } = makeController();
    registerIpcHandlers(controller.ipc, {
      devUrl: 'http://localhost:3210',
      log: vi.fn(),
    });
    const handler = harness.handlers.get('dronepath:update:state')!;
    await expect(
      handler({ senderFrame: { url: 'http://localhost:3210/' } }),
    ).resolves.toEqual({ ready: false });
    await expect(
      handler({ senderFrame: { url: 'http://localhost:3210.evil.test/' } }),
    ).rejects.toThrow('untrusted ipc sender');
  });

  it('rejects non-loopback devUrl origins even when sender matches', async () => {
    const { controller } = makeController();
    registerIpcHandlers(controller.ipc, {
      devUrl: 'https://attacker.example',
      log: vi.fn(),
    });
    const handler = harness.handlers.get('dronepath:update:state')!;
    await expect(
      handler({ senderFrame: { url: 'https://attacker.example/' } }),
    ).rejects.toThrow('untrusted ipc sender');
  });

  it('rejects query channels on unexpected throws instead of resolving { ok: false }', async () => {
    const { controller, session } = makeController();
    controller.attachSession({
      ...session,
      getSession: () => {
        throw new Error('boom');
      },
    });
    setup(controller);
    await expect(invoke('dronepath:session')).rejects.toThrow('boom');
  });
});

describe('desktop language settings', () => {
  it('persists the explicit language alongside the other desktop settings', async () => {
    const local = tmpDir();
    vi.stubEnv('LOCALAPPDATA', local);
    const initial = { ...emptyAppState(), lastOpenDir: local };
    const { controller } = makeController({ appState: initial });
    setup(controller);

    expect(await invoke('dronepath:language')).toEqual({ preference: null, locale: 'en' });
    expect(await invoke('dronepath:language:save', 'en')).toEqual({
      ok: true,
      preference: 'en',
      locale: 'en',
    });
    const file = path.join(local, 'drone-path', 'state.json');
    const restored = readAppState(file);
    expect(restored).toEqual({ ...initial, language: 'en', lastOpenDir: local });

    const restarted = makeController({ appState: restored });
    setup(restarted.controller);
    expect(await invoke('dronepath:language')).toEqual({ preference: 'en', locale: 'en' });
    expect(await invoke('dronepath:language:save', null)).toEqual({
      ok: true,
      preference: null,
      locale: 'en',
    });
    expect(readAppState(file).language).toBeNull();
  });

  it('rejects unsupported values before changing the preference', async () => {
    const { controller } = makeController();
    setup(controller);
    expect(await invoke(IPC_INVOKE_CHANNELS.saveLanguage, 'und')).toEqual({
      ok: false,
      code: 'INVALID_LANGUAGE',
      detail: 'invalid app language',
    });
    expect(await invoke(IPC_INVOKE_CHANNELS.getLanguage)).toEqual({
      preference: null,
      locale: 'en',
    });
  });

  it('keeps the previous preference and preserves filesystem error codes when the settings file cannot be saved', async () => {
    const blocker = writeFile(path.join(tmpDir(), 'unwritable'));
    vi.stubEnv('LOCALAPPDATA', blocker);
    const { controller } = makeController();
    setup(controller);
    const result = (await invoke(IPC_INVOKE_CHANNELS.saveLanguage, 'en')) as {
      ok: boolean;
      code?: string;
      detail?: string;
    };
    expect(result.ok).toBe(false);
    expect(['ENOTDIR', 'FS_EXISTS']).toContain(result.code);
    expect(result.detail).toContain('cannot write app state');
    expect(await invoke(IPC_INVOKE_CHANNELS.getLanguage)).toEqual({
      preference: null,
      locale: 'en',
    });
  });
});

describe('dronepath:export:pick-output', () => {
  it('offers the CLI default name in the out dir anchored at the recording', async () => {
    const clipsDir = tmpDir();
    const video = path.join(clipsDir, 'flight.mp4');
    setup(makeController({ video }).controller);
    const defaultPath = path.join(clipsDir, 'out', 'flight_map.mp4');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: defaultPath });

    const result = await invoke('dronepath:export:pick-output');

    expect(harness.dialog.showSaveDialog).toHaveBeenCalledTimes(1);
    expect(harness.dialog.showSaveDialog.mock.calls[0][0]).toEqual({
      title: 'Export video',
      defaultPath,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    expect(result).toEqual({ ok: true, path: defaultPath });
  });

  it('uses the app window as the dialog parent when it exists', async () => {
    const win: ShellWindow = {
      on: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn(),
      webContents: { send: vi.fn() },
    };
    setup(makeController({ win }).controller);
    harness.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(tmpDir(), 'out.mp4'),
    });

    await invoke('dronepath:export:pick-output');

    expect(harness.dialog.showSaveDialog.mock.calls[0][0]).toBe(win);
    expect(harness.dialog.showSaveDialog.mock.calls[0][1]).toMatchObject({ title: 'Export video' });
  });

  it('appends the .mp4 extension when the dialog name omits it', async () => {
    setup(makeController().controller);
    const chosen = path.join(tmpDir(), 'exports', 'a');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: true, path: `${chosen}.mp4` });
  });

  it('answers a dialog without a path with the canceled result shape', async () => {
    setup(makeController().controller);
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false });

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('asks before replacing an existing file', async () => {
    setup(makeController().controller);
    const chosen = writeFile(path.join(tmpDir(), 'exports', 'a.mp4'));
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });

    const result = await invoke('dronepath:export:pick-output');

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith({
      type: 'warning',
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Replace a.mp4?',
      detail: chosen,
    });
    expect(result).toEqual({ ok: true, path: chosen });
  });

  it('cancels when the replace confirmation is declined', async () => {
    setup(makeController().controller);
    const chosen = writeFile(path.join(tmpDir(), 'exports', 'a.mp4'));
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('re-checks the appended path so an existing file is never silently replaced', async () => {
    setup(makeController().controller);
    const typed = path.join(tmpDir(), 'exports', 'a');
    const appended = writeFile(`${typed}.mp4`);
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: typed });
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

    const result = await invoke('dronepath:export:pick-output');

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ detail: appended }),
    );
    expect(result).toEqual({ ok: false, canceled: true });
  });
});

describe('dronepath:track:pick-output', () => {
  it('offers <basename>.telemetry.json in the export folder', async () => {
    const clipsDir = tmpDir();
    const video = path.join(clipsDir, 'flight.mp4');
    setup(makeController({ video }).controller);
    const defaultPath = path.join(clipsDir, 'out', 'flight.telemetry.json');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: defaultPath });

    const result = await invoke('dronepath:track:pick-output');

    expect(harness.dialog.showSaveDialog.mock.calls[0][0]).toEqual({
      title: 'Export telemetry',
      defaultPath,
      filters: [
        { name: 'Telemetry document (JSON)', extensions: ['json'] },
        { name: 'GPX track', extensions: ['gpx'] },
        { name: 'GeoJSON track', extensions: ['geojson'] },
        { name: 'KML track', extensions: ['kml'] },
        { name: 'KMZ track', extensions: ['kmz'] },
      ],
    });
    expect(result).toEqual({ ok: true, path: defaultPath });
  });

  it('appends .json behind a typed name with another extension', async () => {
    setup(makeController().controller);
    const typed = path.join(tmpDir(), 'exports', 'telemetry-test.csv');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: typed });

    const result = await invoke('dronepath:track:pick-output');

    // The approved name rule keeps the append; the dialogs report this final
    // name so it is never silent.
    expect(result).toEqual({ ok: true, path: `${typed}.json` });
  });

  it('asks before replacing an existing file and cancels when declined', async () => {
    setup(makeController().controller);
    const chosen = writeFile(path.join(tmpDir(), 'exports', 'a.json'));
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

    const result = await invoke('dronepath:track:pick-output');

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ detail: chosen }),
    );
    expect(result).toEqual({ ok: false, canceled: true });
  });
});

describe.for([
  { channel: 'dronepath:export:pick-output', defaultName: 'flight_map.mp4' },
  { channel: 'dronepath:track:pick-output', defaultName: 'flight.telemetry.json' },
])('$channel shared dialog flow', ({ channel, defaultName }) => {
  it('offers the recording folder when no out dir is set', async () => {
    const clipsDir = tmpDir();
    const video = path.join(clipsDir, 'flight.mp4');
    setup(makeController({ video, config: { outDir: null } }).controller);
    const defaultPath = path.join(clipsDir, defaultName);
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: defaultPath });

    await invoke(channel);

    expect(harness.dialog.showSaveDialog.mock.calls[0][0]).toMatchObject({ defaultPath });
  });

  it('answers a cancelled dialog with the canceled result shape', async () => {
    setup(makeController().controller);
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });

    const result = await invoke(channel);

    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('reports NO_RECORDING when nothing is open', async () => {
    setup(makeController({ video: null }).controller);

    const result = await invoke(channel);

    expect(result).toEqual({
      ok: false,
      code: 'NO_RECORDING',
      detail: 'no recording loaded',
    });
  });
});

describe('main-held dialog selection guards (#390)', () => {
  it('rejects export:start without an approved dialog path or with a mismatched path', async () => {
    const { controller, exportRunner } = makeController();
    setup(controller);
    const chosen = path.join(tmpDir(), 'exports', 'approved.mp4');
    const other = path.join(tmpDir(), 'exports', 'other.mp4');

    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath: other, config: {} }),
    ).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
    expect(exportRunner.start).not.toHaveBeenCalled();

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    expect(await invoke(IPC_INVOKE_CHANNELS.pickExportOutput)).toEqual({ ok: true, path: chosen });

    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath: other, config: {} }),
    ).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
    expect(exportRunner.start).not.toHaveBeenCalled();
    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath: chosen, config: {} }),
    ).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
  });

  it('consumes the approved export path once and clears it on canceled re-pick', async () => {
    const { controller, exportRunner } = makeController();
    setup(controller);
    const chosen = path.join(tmpDir(), 'exports', 'approved.mp4');

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    await invoke(IPC_INVOKE_CHANNELS.pickExportOutput);

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await invoke(IPC_INVOKE_CHANNELS.pickExportOutput)).toEqual({ ok: false, canceled: true });
    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath: chosen, config: {} }),
    ).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    await invoke(IPC_INVOKE_CHANNELS.pickExportOutput);
    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath: chosen, config: {} }),
    ).toEqual({ ok: true });
    expect(exportRunner.start).toHaveBeenCalledTimes(1);
    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath: chosen, config: {} }),
    ).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
  });

  it('rejects track:save without an approved dialog path, on mismatch, or on replay', async () => {
    const { controller, session } = makeController();
    setup(controller);
    const chosen = path.join(tmpDir(), 'exports', 'approved.json');
    const other = path.join(tmpDir(), 'exports', 'other.json');

    expect(await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: other })).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
    expect(session.saveTrack).not.toHaveBeenCalled();
    expect(await invoke(IPC_INVOKE_CHANNELS.revealExportOutput, { out: other })).toEqual({
      ok: false,
      code: 'UNKNOWN_OUTPUT',
      detail: 'unknown output',
    });

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    expect(await invoke(IPC_INVOKE_CHANNELS.pickTrackOutput)).toEqual({ ok: true, path: chosen });

    expect(await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: other })).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
    expect(session.saveTrack).not.toHaveBeenCalled();

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    await invoke(IPC_INVOKE_CHANNELS.pickTrackOutput);
    expect(await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: chosen })).toEqual({ ok: true });
    expect(session.saveTrack).toHaveBeenCalledWith(chosen, null);
    expect(await invoke(IPC_INVOKE_CHANNELS.revealExportOutput, { out: chosen })).toEqual({
      ok: true,
    });

    expect(await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: chosen })).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
    expect(session.saveTrack).toHaveBeenCalledTimes(1);
  });

  it('clears pending output selections when a new recording is picked', async () => {
    const { controller } = makeController();
    setup(controller);
    const chosenExport = path.join(tmpDir(), 'exports', 'a.mp4');
    const chosenTrack = path.join(tmpDir(), 'exports', 'a.json');

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosenExport });
    await invoke(IPC_INVOKE_CHANNELS.pickExportOutput);
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosenTrack });
    await invoke(IPC_INVOKE_CHANNELS.pickTrackOutput);

    await invoke(IPC_INVOKE_CHANNELS.pickRecording, { settings: DEFAULT_CONFIG });

    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath: chosenExport, config: {} }),
    ).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
    expect(
      await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: chosenTrack }),
    ).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_APPROVED',
      detail: 'output path was not approved by save dialog',
    });
  });
});

describe('structured IPC error codes and contract parity (#394, #413)', () => {
  it('returns UNKNOWN_OUTPUT for unapproved reveal/open paths and OPEN_FAILED when shell.openPath fails', async () => {
    const { controller } = makeController();
    setup(controller);
    const known = path.join(tmpDir(), 'exports', 'known.json');
    const other = path.join(tmpDir(), 'exports', 'other.json');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: known });
    expect(await invoke(IPC_INVOKE_CHANNELS.pickTrackOutput)).toEqual({ ok: true, path: known });
    expect(await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: known })).toEqual({ ok: true });

    expect(await invoke(IPC_INVOKE_CHANNELS.revealExportOutput, { out: other })).toEqual({
      ok: false,
      code: 'UNKNOWN_OUTPUT',
      detail: 'unknown output',
    });

    harness.shell.openPath.mockResolvedValueOnce('No application is associated with the specified file');
    expect(await invoke(IPC_INVOKE_CHANNELS.openExportOutput, { out: known })).toEqual({
      ok: false,
      code: 'OPEN_FAILED',
      detail: 'No application is associated with the specified file',
    });
  });

  it('returns UPDATES_UNAVAILABLE when updates controller is null and preserves uncataloged backend error codes', async () => {
    const { controller, session } = makeController();
    controller.attachSession({
      ...session,
      saveTrack: () => {
        throw Object.assign(new Error('EIO: disk controller reset'), { code: 'EIO' });
      },
    });
    setup(controller);
    const trackOut = path.join(tmpDir(), 'exports', 'track.json');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: trackOut });
    await invoke(IPC_INVOKE_CHANNELS.pickTrackOutput);

    expect(await invoke(IPC_INVOKE_CHANNELS.restartToUpdate)).toEqual({
      ok: false,
      code: 'UPDATES_UNAVAILABLE',
      detail: 'this build does not self-update',
    });
    expect(await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: trackOut })).toEqual({
      ok: false,
      code: 'EIO',
      detail: 'EIO: disk controller reset',
    });
  });

  it('maps uncataloged plain throws on invoke handlers to BACKEND_ERROR rather than UNKNOWN', async () => {
    const { controller, session } = makeController();
    controller.attachSession({
      ...session,
      saveTrack: () => {
        throw new Error('serializer panicked');
      },
    });
    setup(controller);
    const trackOut = path.join(tmpDir(), 'exports', 'track.json');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: trackOut });
    await invoke(IPC_INVOKE_CHANNELS.pickTrackOutput);

    expect(await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: trackOut })).toEqual({
      ok: false,
      code: 'BACKEND_ERROR',
      detail: 'serializer panicked',
    });
  });

  it('enforces compile-time type parity between AppBridge and main IPC handlers', () => {
    expectTypeOf<keyof AppBridge<Locale>>().toEqualTypeOf<
      keyof typeof IPC_INVOKE_CHANNELS | keyof typeof IPC_EVENT_CHANNELS
    >();
    expectTypeOf<keyof IpcHandlerMap<Locale>>().toEqualTypeOf<IpcInvokeChannel>();
    expectTypeOf<AppBridge<Locale>['saveLanguage']>().parameters.toEqualTypeOf<
      Parameters<IpcHandlerMap<Locale>[typeof IPC_INVOKE_CHANNELS.saveLanguage]>
    >();
    expectTypeOf<ReturnType<AppBridge<Locale>['saveLanguage']>>().toEqualTypeOf<
      Promise<Awaited<ReturnType<IpcHandlerMap<Locale>[typeof IPC_INVOKE_CHANNELS.saveLanguage]>>>
    >();
    expectTypeOf<Parameters<Parameters<AppBridge<Locale>['onUpdateRestartFailed']>[0]>[0]>().toEqualTypeOf<
      Parameters<IpcEventSender>[1] extends infer _ ? Parameters<Parameters<AppBridge<Locale>['onUpdateRestartFailed']>[0]>[0] : never
    >();
    const allChannels = [...Object.values(IPC_INVOKE_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)];
    expect(new Set(allChannels).size).toBe(32);
    expectTypeOf<IpcEventChannel>().toEqualTypeOf<
      (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS]
    >();
  });
});

describe('pick, settings, export, track, update, and window IPC handlers (#405)', () => {
  it('forwards parsed appearance settings on pick and preserves pending outputs on cancel', async () => {
    const { controller, session, exportRunner } = makeController();
    setup(controller);
    const chosen = path.join(tmpDir(), 'exports', 'approved.mp4');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    await invoke(IPC_INVOKE_CHANNELS.pickExportOutput);

    vi.mocked(session.pick).mockResolvedValueOnce({ ok: false, canceled: true });
    expect(
      await invoke(IPC_INVOKE_CHANNELS.pickRecording, { settings: settingsPatchOf(DEFAULT_CONFIG) }),
    ).toEqual({ ok: false, canceled: true });
    expect(session.pick).toHaveBeenCalledWith({
      settings: {
        style: DEFAULT_CONFIG.style,
        view: DEFAULT_CONFIG.view,
        zoom: DEFAULT_CONFIG.zoom,
        zoomOut: DEFAULT_CONFIG.zoomOut,
        hud: DEFAULT_CONFIG.hud,
        introSec: DEFAULT_CONFIG.introSec,
        outroSec: DEFAULT_CONFIG.outroSec,
        trailColor: DEFAULT_CONFIG.trailColor,
      },
    });

    // A canceled pick must not clear the still-pending approved export path.
    expect(await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath: chosen, config: {} })).toEqual({
      ok: true,
    });
    expect(exportRunner.start).toHaveBeenCalledTimes(1);

    const invalid = (await invoke(IPC_INVOKE_CHANNELS.pickRecording, {
      settings: { style: 'bogus' },
    })) as { ok: boolean; code?: string };
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe('INVALID_REQUEST');
    expect(session.pick).toHaveBeenCalledTimes(1);
  });

  it('reads, persists, and validates desktop settings patches', async () => {
    const local = tmpDir();
    vi.stubEnv('LOCALAPPDATA', local);
    const { controller } = makeController();
    setup(controller);

    expect(await invoke(IPC_INVOKE_CHANNELS.getSettings)).toEqual(DEFAULT_CONFIG);

    const nextPatch = { ...settingsPatchOf(DEFAULT_CONFIG), style: 'topo' as const, zoom: 15 };
    expect(await invoke(IPC_INVOKE_CHANNELS.saveSettings, nextPatch)).toEqual({ ok: true });
    expect(await invoke(IPC_INVOKE_CHANNELS.getSettings)).toMatchObject({ style: 'topo', zoom: 15 });
    const file = path.join(local, 'drone-path', 'state.json');
    expect(readAppState(file).settings).toEqual(nextPatch);

    // Invalid patch returns a structured failure without mutating settings.
    const invalid = (await invoke(IPC_INVOKE_CHANNELS.saveSettings, {
      ...nextPatch,
      unknownKey: true,
    })) as {
      ok: boolean;
      code?: string;
    };
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe('INVALID_REQUEST');
    expect(await invoke(IPC_INVOKE_CHANNELS.getSettings)).toMatchObject({ style: 'topo', zoom: 15 });

    // Missing required patch keys also fail cleanly without mutating settings.
    expect(await invoke(IPC_INVOKE_CHANNELS.saveSettings, { style: 'satellite' })).toMatchObject({
      ok: false,
      code: 'BACKEND_ERROR',
    });
    expect(await invoke(IPC_INVOKE_CHANNELS.getSettings)).toMatchObject({ style: 'topo', zoom: 15 });

    // Best-effort persistence still applies settings in memory if the state file cannot be written.
    const blocker = writeFile(path.join(tmpDir(), 'unwritable'));
    vi.stubEnv('LOCALAPPDATA', blocker);
    const zoomedOutPatch = { ...nextPatch, zoom: 11 };
    expect(await invoke(IPC_INVOKE_CHANNELS.saveSettings, zoomedOutPatch)).toEqual({ ok: true });
    expect(await invoke(IPC_INVOKE_CHANNELS.getSettings)).toMatchObject({ zoom: 11 });
  });

  it('starts and cancels exports and validates export preconditions', async () => {
    const video = path.join(tmpDir(), 'flight.mp4');
    const { controller, exportRunner } = makeController({ video });
    setup(controller);
    const outPath = path.join(tmpDir(), 'exports', 'flight_map.mp4');

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: outPath });
    await invoke(IPC_INVOKE_CHANNELS.pickExportOutput);
    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, {
        outPath,
        config: { width: 1280, height: 720 },
        range: { start: 10, end: 50 },
      }),
    ).toEqual({ ok: true });
    expect(exportRunner.start).toHaveBeenCalledWith(video, {
      outPath,
      config: expect.objectContaining({ width: 1280, height: 720 }),
      range: { start: 10, end: 50 },
    });

    // Invalid request leaves pending approval unconsumed and does not start export.
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: outPath });
    await invoke(IPC_INVOKE_CHANNELS.pickExportOutput);
    const badStart = (await invoke(IPC_INVOKE_CHANNELS.startExport, null)) as {
      ok: boolean;
      code?: string;
    };
    expect(badStart.ok).toBe(false);
    expect(badStart.code).toBe('INVALID_REQUEST');
    expect(exportRunner.start).toHaveBeenCalledTimes(1);

    expect(await invoke(IPC_INVOKE_CHANNELS.cancelExport)).toEqual({ ok: true });
    expect(exportRunner.cancel).toHaveBeenCalledTimes(1);

    // Without a loaded recording or attached runner, handlers return structured errors.
    const noVideo = makeController({ video: null });
    noVideo.controller.attachExportRunner(null);
    setup(noVideo.controller);
    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath, config: {} }),
    ).toEqual({
      ok: false,
      code: 'BACKEND_ERROR',
      detail: 'export runner not initialized',
    });
    expect(await invoke(IPC_INVOKE_CHANNELS.cancelExport)).toEqual({
      ok: false,
      code: 'BACKEND_ERROR',
      detail: 'export runner not initialized',
    });
    noVideo.controller.attachExportRunner(noVideo.exportRunner);
    expect(
      await invoke(IPC_INVOKE_CHANNELS.startExport, { outPath, config: {} }),
    ).toEqual({
      ok: false,
      code: 'NO_RECORDING',
      detail: 'no recording loaded',
    });
  });

  it('rejects unrecorded or malformed knownOutputOf payloads and opens/reveals recorded outputs', async () => {
    const { controller } = makeController();
    setup(controller);
    const exportOut = path.join(tmpDir(), 'exports', 'flight_map.mp4');
    const failedOut = path.join(tmpDir(), 'exports', 'failed.mp4');

    // Pending-only approval is not revealable until saved/completed.
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: exportOut });
    await invoke(IPC_INVOKE_CHANNELS.pickExportOutput);
    for (const payload of [null, {}, { out: 123 }, { out: exportOut }, { out: failedOut }]) {
      expect(await invoke(IPC_INVOKE_CHANNELS.revealExportOutput, payload)).toEqual({
        ok: false,
        code: 'UNKNOWN_OUTPUT',
        detail: 'unknown output',
      });
      expect(await invoke(IPC_INVOKE_CHANNELS.openExportOutput, payload)).toEqual({
        ok: false,
        code: 'UNKNOWN_OUTPUT',
        detail: 'unknown output',
      });
    }

    // Failed or canceled exports must not register outputs in the allowlist.
    controller.handleExportDone({
      status: 'error',
      code: 'BACKEND_ERROR',
      detail: 'ffmpeg failed',
    });
    controller.handleExportDone({ status: 'canceled' });
    expect(await invoke(IPC_INVOKE_CHANNELS.openExportOutput, { out: exportOut })).toEqual({
      ok: false,
      code: 'UNKNOWN_OUTPUT',
      detail: 'unknown output',
    });

    // Completed export registers its output for both reveal and open.
    controller.handleExportDone({
      status: 'ok',
      summary: { video: 'a.mp4', out: exportOut, status: 'ok', elapsedSec: 1, frames: 30, fps: '30' },
    });
    expect(await invoke(IPC_INVOKE_CHANNELS.revealExportOutput, { out: exportOut })).toEqual({
      ok: true,
    });
    expect(harness.shell.showItemInFolder).toHaveBeenCalledWith(exportOut);

    harness.shell.openPath.mockResolvedValueOnce('');
    expect(await invoke(IPC_INVOKE_CHANNELS.openExportOutput, { out: exportOut })).toEqual({
      ok: true,
    });
    expect(harness.shell.openPath).toHaveBeenCalledWith(exportOut);
  });

  it('saves track ranges with logging and rejects invalid track requests', async () => {
    const log = vi.fn();
    const { controller, session } = makeController();
    setup(controller, log);
    const chosen = path.join(tmpDir(), 'exports', 'clip.gpx');

    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    await invoke(IPC_INVOKE_CHANNELS.pickTrackOutput);
    expect(
      await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: chosen, range: { start: 5, end: 25 } }),
    ).toEqual({ ok: true });
    expect(session.saveTrack).toHaveBeenCalledWith(chosen, { start: 5, end: 25 });
    expect(log).toHaveBeenCalledWith(`track: wrote ${chosen}`);
    expect(await invoke(IPC_INVOKE_CHANNELS.revealExportOutput, { out: chosen })).toEqual({
      ok: true,
    });
    expect(harness.shell.showItemInFolder).toHaveBeenCalledWith(chosen);

    expect(
      await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: 'relative/track.gpx' }),
    ).toMatchObject({ ok: false, code: 'OUTPUT_PATH_ABSOLUTE' });
    expect(
      await invoke(IPC_INVOKE_CHANNELS.saveTrack, {
        outPath: path.join(tmpDir(), 'exports', 'track.txt'),
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(
      await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: chosen, range: { start: 10, end: 5 } }),
    ).toMatchObject({ ok: false, code: 'BACKEND_ERROR' });

    const noVideo = makeController({ video: null });
    setup(noVideo.controller);
    expect(await invoke(IPC_INVOKE_CHANNELS.saveTrack, { outPath: chosen })).toEqual({
      ok: false,
      code: 'NO_RECORDING',
      detail: 'no recording loaded',
    });
  });

  it('reports update readiness and delegates update:restart and window:close', async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    let destroyed = false;
    const win: ShellWindow = {
      on: vi.fn(),
      isDestroyed: () => destroyed,
      close: vi.fn(() => {
        destroyed = true;
      }),
      webContents: {
        send: (channel, payload) => sent.push({ channel, payload }),
      },
    };
    const { controller } = makeController({ win });
    controller.markUpdateReady();
    controller.attachUpdates({
      restart: ({ onError }) => {
        onError({ code: 'UPDATE_RESTART_FAILED', detail: 'installer busy' });
        return { ok: true };
      },
    });
    setup(controller);

    expect(await invoke(IPC_INVOKE_CHANNELS.getUpdateState)).toEqual({ ready: true });
    expect(await invoke(IPC_INVOKE_CHANNELS.restartToUpdate)).toEqual({ ok: true });
    expect(sent).toEqual([
      {
        channel: IPC_EVENT_CHANNELS.onUpdateRestartFailed,
        payload: { code: 'UPDATE_RESTART_FAILED', detail: 'installer busy' },
      },
    ]);

    await expect(invoke(IPC_INVOKE_CHANNELS.closeWindow)).resolves.toBeUndefined();
    expect(win.close).toHaveBeenCalledTimes(1);

    // Calling close again after the window is destroyed is a safe no-op.
    await expect(invoke(IPC_INVOKE_CHANNELS.closeWindow)).resolves.toBeUndefined();
    expect(win.close).toHaveBeenCalledTimes(1);

    // Query channels also reject untrusted senders.
    const closeHandler = harness.handlers.get(IPC_INVOKE_CHANNELS.closeWindow)!;
    await expect(
      closeHandler({ senderFrame: { url: 'https://attacker.example/' } }),
    ).rejects.toThrow('untrusted ipc sender');
  });
});

describe('archive IPC handlers (#326)', () => {
  it('picks, lists, scans, cancels, queries, finds near points, removes roots, and opens clips', async () => {
    const dir = tmpDir();
    const { controller, session } = makeController({ video: path.join(dir, 'clip.mp4') });
    let roots: string[] = [];
    const scan = vi.fn(async () => ({ scanned: 2 }));
    const cancelScan = vi.fn();
    const query = vi.fn(() => ({ flights: [], totalCount: 0, offlineCount: 0 }));
    const findAtPoint = vi.fn(() => []);
    let fileExists = true;
    const pruneOffline = vi.fn(() => 2);
    controller.attachArchiveService({
      listRoots: () => [...roots],
      addRoot: (nextDir) => {
        roots = [nextDir];
        return [...roots];
      },
      removeRoot: (targetDir) => {
        roots = roots.filter((r) => r !== path.resolve(targetDir));
        return [...roots];
      },
      scan,
      cancelScan,
      query,
      findAtPoint,
      pruneOffline,
      clipAvailability: () => (fileExists ? 'online' : 'offline'),
      fileExists: () => fileExists,
    });
    setup(controller);

    harness.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke(IPC_INVOKE_CHANNELS.pickArchiveFolder)).toEqual({ ok: false, canceled: true });

    harness.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [dir] });
    expect(await invoke(IPC_INVOKE_CHANNELS.pickArchiveFolder)).toEqual({
      ok: true,
      root: path.resolve(dir),
      roots: [path.resolve(dir)],
    });
    expect(harness.dialog.showOpenDialog).toHaveBeenLastCalledWith({
      title: 'Choose a folder of drone recordings',
      properties: ['openDirectory'],
    });
    expect(await invoke(IPC_INVOKE_CHANNELS.listArchiveRoots)).toEqual([path.resolve(dir)]);

    expect(await invoke(IPC_INVOKE_CHANNELS.scanArchive, [dir])).toEqual({ ok: true, scanned: 2 });
    expect(scan).toHaveBeenCalledWith([dir]);

    expect(await invoke(IPC_INVOKE_CHANNELS.cancelArchiveScan)).toEqual({ ok: true });
    expect(cancelScan).toHaveBeenCalledTimes(1);

    expect(await invoke(IPC_INVOKE_CHANNELS.queryArchive, { availability: 'online' })).toEqual({
      flights: [],
      totalCount: 0,
      offlineCount: 0,
    });
    expect(query).toHaveBeenCalledWith({ availability: 'online' });

    expect(await invoke(IPC_INVOKE_CHANNELS.findArchiveAtPoint, { lat: 46.6, lon: 14.2 }, 50, false)).toEqual([]);
    expect(findAtPoint).toHaveBeenCalledWith({ lat: 46.6, lon: 14.2 }, 50, false);

    const clipPath = path.join(dir, 'clip.mp4');
    expect(
      await invoke(IPC_INVOKE_CHANNELS.openArchiveClip, {
        path: clipPath,
        settings: settingsPatchOf(DEFAULT_CONFIG),
        seekSec: 4,
      }),
    ).toEqual({ ok: true });
    expect(session.openFile).toHaveBeenCalledWith(
      clipPath,
      parsePickRequest({ settings: settingsPatchOf(DEFAULT_CONFIG) }),
    );

    fileExists = false;
    expect(
      await invoke(IPC_INVOKE_CHANNELS.openArchiveClip, {
        path: clipPath,
        settings: settingsPatchOf(DEFAULT_CONFIG),
      }),
    ).toEqual({
      ok: false,
      code: 'ARCHIVE_CLIP_OFFLINE',
      detail: `recording is offline or missing: ${clipPath}`,
      params: { name: 'clip.mp4', path: clipPath },
    });

    expect(await invoke(IPC_INVOKE_CHANNELS.pruneArchiveOffline)).toEqual({ ok: true, removed: 2 });
    expect(pruneOffline).toHaveBeenCalledTimes(1);

    expect(await invoke(IPC_INVOKE_CHANNELS.removeArchiveRoot, dir)).toEqual({ ok: true, roots: [] });
  });
});
