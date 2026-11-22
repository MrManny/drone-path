import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { registerIpcHandlers } from '../app/ipc.mjs';
import { appStateFile } from '../src/apppaths.js';
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
import { DEFAULT_CONFIG } from 'drone-path-engine/config';
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

function setup(controller: ShellController): void {
  registerIpcHandlers(controller.ipc, { devUrl: null, log: vi.fn() });
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
    expect(new Set(allChannels).size).toBe(22);
    expectTypeOf<IpcEventChannel>().toEqualTypeOf<
      (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS]
    >();
  });
});
