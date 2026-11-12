import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerIpcHandlers } from '../app/ipc.mjs';
import type { IpcState, IpcWindow } from '../app/ipc.mjs';
import { APP_ORIGIN } from '../src/apppaths.js';
import { emptyAppState } from '../src/appstate.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

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

function fakeState(options: {
  video?: string | null;
  config?: Partial<RenderConfig>;
  win?: IpcWindow | null;
} = {}): IpcState {
  const video =
    options.video === undefined ? path.join(tmpDir(), 'flight.mp4') : options.video;
  return {
    session: {
      pick: vi.fn(async () => ({ ok: true })),
      getSession: vi.fn(() => null),
      videoPath: () => video,
      saveTelemetryJson: vi.fn(() => {}),
    },
    config: { ...DEFAULT_CONFIG, ...options.config },
    appState: emptyAppState(),
    win: options.win ?? null,
    exportRunner: {
      start: vi.fn(
        (_video: string, _request: Parameters<IpcState['exportRunner']['start']>[1]) => {},
      ),
      cancel: vi.fn(() => {}),
    },
    updates: null,
    updateReady: false,
    lastExportOut: null,
    lastTelemetryOut: null,
  };
}

function setup(state: IpcState): void {
  registerIpcHandlers(state, { devUrl: null, log: vi.fn(), sendToWindow: vi.fn() });
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

afterEach(cleanupTmpDirs);

describe('dronepath:export:pick-output', () => {
  it('offers the CLI default name in the out dir anchored at the recording', async () => {
    const clipsDir = tmpDir();
    const video = path.join(clipsDir, 'flight.mp4');
    setup(fakeState({ video }));
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

  it('offers the recording folder when no out dir is set', async () => {
    const clipsDir = tmpDir();
    const video = path.join(clipsDir, 'flight.mp4');
    setup(fakeState({ video, config: { outDir: null } }));
    const defaultPath = path.join(clipsDir, 'flight_map.mp4');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: defaultPath });

    await invoke('dronepath:export:pick-output');

    expect(harness.dialog.showSaveDialog.mock.calls[0][0]).toMatchObject({ defaultPath });
  });

  it('uses the app window as the dialog parent when it exists', async () => {
    const win: IpcWindow = { isDestroyed: () => false, close: vi.fn() };
    setup(fakeState({ win }));
    harness.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(tmpDir(), 'out.mp4'),
    });

    await invoke('dronepath:export:pick-output');

    expect(harness.dialog.showSaveDialog.mock.calls[0][0]).toBe(win);
    expect(harness.dialog.showSaveDialog.mock.calls[0][1]).toMatchObject({ title: 'Export video' });
  });

  it('appends the .mp4 extension when the dialog name omits it', async () => {
    setup(fakeState());
    const chosen = path.join(tmpDir(), 'exports', 'a');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: true, path: `${chosen}.mp4` });
  });

  it('keeps a typed .mp4 name untouched', async () => {
    setup(fakeState());
    const chosen = path.join(tmpDir(), 'exports', 'A.MP4');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: true, path: chosen });
  });

  it('answers a cancelled dialog with the canceled result shape', async () => {
    setup(fakeState());
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('answers a dialog without a path with the canceled result shape', async () => {
    setup(fakeState());
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false });

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('asks before replacing an existing file', async () => {
    setup(fakeState());
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
    setup(fakeState());
    const chosen = writeFile(path.join(tmpDir(), 'exports', 'a.mp4'));
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('re-checks the appended path so an existing file is never silently replaced', async () => {
    setup(fakeState());
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

  it('reports no recording loaded when nothing is open', async () => {
    setup(fakeState({ video: null }));

    const result = await invoke('dronepath:export:pick-output');

    expect(result).toEqual({ ok: false, error: 'no recording loaded' });
  });
});

describe('dronepath:telemetry:pick-output', () => {
  it('offers <basename>.telemetry.json in the export folder', async () => {
    const clipsDir = tmpDir();
    const video = path.join(clipsDir, 'flight.mp4');
    setup(fakeState({ video }));
    const defaultPath = path.join(clipsDir, 'out', 'flight.telemetry.json');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: defaultPath });

    const result = await invoke('dronepath:telemetry:pick-output');

    expect(harness.dialog.showSaveDialog.mock.calls[0][0]).toEqual({
      title: 'Export telemetry',
      defaultPath,
      filters: [{ name: 'JSON document', extensions: ['json'] }],
    });
    expect(result).toEqual({ ok: true, path: defaultPath });
  });

  it('offers the recording folder when no out dir is set', async () => {
    const clipsDir = tmpDir();
    const video = path.join(clipsDir, 'flight.mp4');
    setup(fakeState({ video, config: { outDir: null } }));
    const defaultPath = path.join(clipsDir, 'flight.telemetry.json');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: defaultPath });

    await invoke('dronepath:telemetry:pick-output');

    expect(harness.dialog.showSaveDialog.mock.calls[0][0]).toMatchObject({ defaultPath });
  });

  it('appends the .json extension when the dialog name omits it', async () => {
    setup(fakeState());
    const chosen = path.join(tmpDir(), 'exports', 'a');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });

    const result = await invoke('dronepath:telemetry:pick-output');

    expect(result).toEqual({ ok: true, path: `${chosen}.json` });
  });

  it('keeps a typed .json name untouched', async () => {
    setup(fakeState());
    const chosen = path.join(tmpDir(), 'exports', 'A.JSON');
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });

    const result = await invoke('dronepath:telemetry:pick-output');

    expect(result).toEqual({ ok: true, path: chosen });
  });

  it('answers a cancelled dialog with the canceled result shape', async () => {
    setup(fakeState());
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });

    const result = await invoke('dronepath:telemetry:pick-output');

    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('asks before replacing an existing file and cancels when declined', async () => {
    setup(fakeState());
    const chosen = writeFile(path.join(tmpDir(), 'exports', 'a.json'));
    harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: chosen });
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

    const result = await invoke('dronepath:telemetry:pick-output');

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ detail: chosen }),
    );
    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('reports no recording loaded when nothing is open', async () => {
    setup(fakeState({ video: null }));

    const result = await invoke('dronepath:telemetry:pick-output');

    expect(result).toEqual({ ok: false, error: 'no recording loaded' });
  });
});
