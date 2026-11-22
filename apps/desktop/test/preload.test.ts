import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IPC_VOID_EVENT_KEYS,
} from '../shared/ipc.js';
import type { EventMethodName, InvokeMethodName } from '../shared/ipc.js';
import { buildPreloadSource } from '../scripts/build-preload.mjs';
import { emptyAppState } from '../src/appstate.js';
import { createShellController } from '../src/shellcontroller.js';
import { DEFAULT_CONFIG } from 'drone-path-engine/config';

type InvokeListener = (event: unknown, ...args: unknown[]) => void;

const ipcHarness = vi.hoisted(() => ({
  registered: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown): void => {
      ipcHarness.registered.set(channel, handler);
    },
  },
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn() },
}));

import { registerIpcHandlers } from '../app/ipc.mjs';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preloadPath = path.join(desktopRoot, 'app', 'preload.cjs');

function loadPreloadInSandbox() {
  let exposedKey: string | null = null;
  let exposedApi: Record<string, (...args: unknown[]) => unknown> | null = null;
  const listeners = new Map<string, Set<InvokeListener>>();
  const invoke = vi.fn(async (_channel: string, ..._args: unknown[]) => ({ ok: true }));
  const on = vi.fn((channel: string, handler: InvokeListener) => {
    const set = listeners.get(channel) ?? new Set();
    set.add(handler);
    listeners.set(channel, set);
  });
  const removeListener = vi.fn((channel: string, handler: InvokeListener) => {
    listeners.get(channel)?.delete(handler);
  });
  const contextBridge = {
    exposeInMainWorld: vi.fn((key: string, api: Record<string, (...args: unknown[]) => unknown>) => {
      exposedKey = key;
      exposedApi = api;
    }),
  };

  const sandboxRequire = (id: string) => {
    if (id !== 'electron') {
      throw new Error(`sandboxed preload must not require "${id}"`);
    }
    return { contextBridge, ipcRenderer: { invoke, on, removeListener } };
  };

  const source = fs.readFileSync(preloadPath, 'utf8');
  vm.runInNewContext(source, { require: sandboxRequire }, { filename: preloadPath });
  if (exposedKey !== 'dronepath' || !exposedApi) {
    throw new Error('preload did not expose window.dronepath');
  }

  return {
    api: exposedApi as Record<string, (...args: unknown[]) => unknown>,
    invoke,
    on,
    removeListener,
    emit(channel: string, payload?: unknown) {
      for (const handler of [...(listeners.get(channel) ?? [])]) {
        handler({}, payload);
      }
    },
  };
}

beforeEach(() => {
  ipcHarness.registered.clear();
});

describe('preload bridge runtime contracts', () => {
  it('matches the generated preload artifact from shared/ipc.ts', () => {
    expect(fs.readFileSync(preloadPath, 'utf8')).toBe(buildPreloadSource());
  });

  it('exposes the exact 22 invoke and event methods in a sandboxed preload', () => {
    const { api } = loadPreloadInSandbox();
    const expected = [
      ...Object.keys(IPC_INVOKE_CHANNELS),
      ...Object.keys(IPC_EVENT_CHANNELS),
    ].sort();
    expect(Object.keys(api).sort()).toEqual(expected);
  });

  it.each(Object.entries(IPC_INVOKE_CHANNELS) as Array<[InvokeMethodName, string]>)(
    'forwards %s() to ipcRenderer.invoke(%s)',
    async (method, channel) => {
      const { api, invoke } = loadPreloadInSandbox();
      const arg = { sample: method };
      await api[method](arg);
      expect(invoke).toHaveBeenCalledWith(channel, arg);
    },
  );

  it.each(Object.entries(IPC_EVENT_CHANNELS) as Array<[EventMethodName, string]>)(
    'subscribes %s() to %s and unsubscribes cleanly',
    (method, channel) => {
      const { api, on, removeListener, emit } = loadPreloadInSandbox();
      const cb = vi.fn();
      const unsubscribe = api[method](cb) as () => void;
      expect(on).toHaveBeenCalledWith(channel, expect.any(Function));

      const payload = { detail: 'sample' };
      emit(channel, payload);
      if (IPC_VOID_EVENT_KEYS.has(method)) {
        expect(cb).toHaveBeenCalledWith();
      } else {
        expect(cb).toHaveBeenCalledWith(payload);
      }

      unsubscribe();
      expect(removeListener).toHaveBeenCalledWith(channel, expect.any(Function));
      cb.mockClear();
      emit(channel, payload);
      expect(cb).not.toHaveBeenCalled();
    },
  );

  it('matches registered main-process IPC invoke channels 1-to-1 at runtime', () => {
    const controller = createShellController({
      config: DEFAULT_CONFIG,
      appState: emptyAppState(),
      stateStore: { read: emptyAppState, write: vi.fn(), saveSafely: vi.fn() },
      systemLanguages: ['en-US'],
      dirExists: () => true,
      confirmStopExport: async () => false,
      quitApp: vi.fn(),
      log: vi.fn(),
    });
    registerIpcHandlers(controller.ipc, { devUrl: null, log: vi.fn() });
    expect([...ipcHarness.registered.keys()].sort()).toEqual(
      Object.values(IPC_INVOKE_CHANNELS).sort(),
    );
  });
});
