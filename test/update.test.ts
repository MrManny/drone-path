import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initUpdates } from '../app/update.mjs';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

type Listener = (...args: unknown[]) => void;

const harness = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  const track = (event: string, handler: Listener): void => {
    const list = listeners.get(event) ?? [];
    list.push(handler);
    listeners.set(event, list);
  };
  const remove = (event: string, handler: Listener): void => {
    listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== handler));
  };
  return {
    listeners,
    track,
    emit(event: string, ...args: unknown[]): void {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(...args);
    },
    remove,
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      logger: null as { info: Listener; warn: Listener; error: Listener } | null,
      on: (event: string, handler: Listener) => track(event, handler),
      once: (event: string, handler: Listener) => track(event, handler),
      removeListener: (event: string, handler: Listener) => remove(event, handler),
      checkForUpdates: vi.fn(() => Promise.resolve()),
      quitAndInstall: vi.fn(),
    },
    app: { isPackaged: true },
  };
});

vi.mock('electron', () => ({ app: harness.app }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: harness.autoUpdater } }));

function resourcesDir(withMetadata: boolean): string {
  const dir = path.join(tmpDir(), 'resources');
  fs.mkdirSync(dir, { recursive: true });
  if (withMetadata) fs.writeFileSync(path.join(dir, 'app-update.yml'), 'provider: github\n');
  Object.defineProperty(process, 'resourcesPath', { value: dir, configurable: true });
  return dir;
}

beforeEach(() => {
  harness.listeners.clear();
  harness.app.isPackaged = true;
  harness.autoUpdater.autoDownload = false;
  harness.autoUpdater.autoInstallOnAppQuit = false;
  harness.autoUpdater.logger = null;
  vi.clearAllMocks();
});

afterEach(cleanupTmpDirs);

describe.each([
  { when: 'the app is unpackaged', packaged: false, metadata: true },
  { when: 'the build carries no update metadata (portable)', packaged: true, metadata: false },
])('initUpdates: $when', ({ packaged, metadata }) => {
  it('returns no controller and never touches the feed', () => {
    harness.app.isPackaged = packaged;
    resourcesDir(metadata);
    expect(initUpdates({ log: vi.fn(), onReady: vi.fn() })).toBeNull();
    expect(harness.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe('initUpdates with update metadata', () => {
  function start() {
    resourcesDir(true);
    const log = vi.fn();
    const onReady = vi.fn();
    const controller = initUpdates({ log, onReady });
    if (!controller) throw new Error('expected an update controller');
    return { log, onReady, controller };
  }

  it('checks quietly in the background and installs on quit', () => {
    start();
    expect(harness.autoUpdater.autoDownload).toBe(true);
    expect(harness.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(harness.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('routes updater chatter to stderr', () => {
    const { log } = start();
    harness.autoUpdater.logger?.info('hello');
    expect(log).toHaveBeenCalledWith('update: hello');
  });

  it('announces a downloaded update', () => {
    const { onReady } = start();
    harness.emit('update-downloaded');
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('logs feed errors and keeps going', () => {
    const { log } = start();
    harness.emit('error', new Error('offline'));
    expect(log).toHaveBeenCalledWith('update failed: offline');
    expect(harness.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('logs a rejected check and never throws', async () => {
    harness.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    const { log } = start();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('update check failed: offline'));
  });

  it('restarts into the update', () => {
    const { controller } = start();
    const onError = vi.fn();
    expect(controller.restart({ onError })).toEqual({ ok: true });
    expect(harness.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a thrown install failure instead of stranding the prompt', () => {
    const { controller } = start();
    harness.autoUpdater.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    const onError = vi.fn();
    expect(controller.restart({ onError })).toEqual({ ok: false, error: 'spawn failed' });
  });

  it('reports an install failure emitted on the error channel', () => {
    const { controller } = start();
    const onError = vi.fn();
    expect(controller.restart({ onError })).toEqual({ ok: true });
    harness.emit('error', new Error('spawn failed'));
    expect(onError).toHaveBeenCalledWith('spawn failed');
  });
});
