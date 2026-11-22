import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

const harness = vi.hoisted(() => ({
  app: {
    getPreferredSystemLanguages: vi.fn(() => ['en-US']),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
    isPackaged: false,
  },
  dialog: {
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showErrorBox: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: vi.fn(),
      },
    },
  },
}));

vi.mock('electron', () => ({
  app: harness.app,
  BrowserWindow: vi.fn(),
  dialog: harness.dialog,
  Menu: { setApplicationMenu: vi.fn() },
  net: { fetch: vi.fn() },
  protocol: harness.protocol,
  session: harness.session,
  shell: { openExternal: vi.fn() },
}));

vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }));

import {
  createShellState,
  handleExportDone,
  handleWindowAllClosed,
  installCloseGuard,
  installNavigationGuards,
  installSecurityHeaders,
  resolveDesktopConfig,
} from '../app/main.mjs';
import type { HeaderSession, MainWindow, NavigationWebContents, ShellState } from '../app/main.mjs';
import { APP_ORIGIN } from '../src/apppaths.js';
import { buildRendererCsp } from '../src/securityheaders.js';

function makeWindow() {
  let closeHandler: ((e: { preventDefault(): void }) => void) | null = null;
  let destroyed = false;
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const win: MainWindow = {
    on: (_event, listener) => {
      closeHandler = listener;
    },
    isDestroyed: () => destroyed,
    close: vi.fn(() => {
      const event = { preventDefault: vi.fn() };
      closeHandler?.(event);
      if (!event.preventDefault.mock.calls.length) destroyed = true;
    }),
    webContents: {
      send: (channel, payload) => {
        sent.push({ channel, payload });
      },
    },
  };
  const attemptClose = () => {
    const event = { preventDefault: vi.fn() };
    closeHandler?.(event);
    return event;
  };
  return { win, sent, attemptClose, markDestroyed: () => { destroyed = true; } };
}

function makeState(running: () => boolean, cancel = vi.fn()): { state: ShellState; cancel: ReturnType<typeof vi.fn>; winTools: ReturnType<typeof makeWindow> } {
  const state = createShellState();
  const winTools = makeWindow();
  state.win = winTools.win;
  state.exportRunner = { running, cancel };
  installCloseGuard(state);
  return { state, cancel, winTools };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTmpDirs();
});

describe('window close guard and export completion', () => {
  it('allows closing immediately when no export is running', () => {
    const { winTools } = makeState(() => false);
    const event = winTools.attemptClose();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('cancels a running export and closes once onDone arrives when Stop export is chosen', async () => {
    let active = true;
    const cancel = vi.fn();
    const { state, winTools } = makeState(() => active, cancel);
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });

    const event = winTools.attemptClose();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(state.closePromptOpen).toBe(true);

    await flushMicrotasks();
    expect(state.closePromptOpen).toBe(false);
    expect(state.pendingClose).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);

    active = false;
    handleExportDone(state, { status: 'canceled' });
    expect(state.pendingClose).toBe(false);
    expect(winTools.win.close).toHaveBeenCalledTimes(1);
    expect(winTools.sent).toEqual([{ channel: 'dronepath:export:done', payload: { status: 'canceled' } }]);
  });

  it('keeps the export running and leaves pendingClose false when Keep exporting is chosen', async () => {
    const cancel = vi.fn();
    const { state, winTools } = makeState(() => true, cancel);
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

    const event = winTools.attemptClose();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await flushMicrotasks();

    expect(state.closePromptOpen).toBe(false);
    expect(state.pendingClose).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(winTools.win.close).not.toHaveBeenCalled();
  });

  it('closes cleanly without poisoning future close guards when an export finishes while the prompt is open', async () => {
    let active = true;
    const cancel = vi.fn();
    const { state, winTools } = makeState(() => active, cancel);

    let resolveDialog!: (value: { response: number }) => void;
    harness.dialog.showMessageBox.mockImplementationOnce(
      () =>
        new Promise<{ response: number }>((resolve) => {
          resolveDialog = resolve;
        }),
    );

    const firstClose = winTools.attemptClose();
    expect(firstClose.preventDefault).toHaveBeenCalledTimes(1);
    expect(state.closePromptOpen).toBe(true);

    // Export completes while the confirmation prompt is still open.
    active = false;
    handleExportDone(state, {
      status: 'ok',
      summary: { video: 'a.mp4', out: 'out.mp4', status: 'ok', elapsedSec: 1, frames: 30, fps: '30' },
    });
    expect(state.lastExportOut).toBe('out.mp4');
    expect(state.pendingClose).toBe(false);
    expect(winTools.win.close).not.toHaveBeenCalled();

    // User clicks "Stop export" after the export has already settled.
    resolveDialog({ response: 0 });
    await flushMicrotasks();

    expect(state.closePromptOpen).toBe(false);
    expect(state.pendingClose).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(winTools.win.close).toHaveBeenCalledTimes(1);

    // Future exports must still be protected by the close guard.
    active = true;
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    const secondClose = winTools.attemptClose();
    expect(secondClose.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
    expect(state.closePromptOpen).toBe(false);
  });

  it('ignores a second close attempt while the confirmation prompt is already open', async () => {
    const { winTools } = makeState(() => true);
    let resolveDialog!: (value: { response: number }) => void;
    harness.dialog.showMessageBox.mockImplementationOnce(
      () =>
        new Promise<{ response: number }>((resolve) => {
          resolveDialog = resolve;
        }),
    );

    const first = winTools.attemptClose();
    const second = winTools.attemptClose();
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(second.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(1);

    resolveDialog({ response: 1 });
    await flushMicrotasks();
  });

  it('resets closePromptOpen and logs when dialog.showMessageBox rejects', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { state, winTools } = makeState(() => true);
    harness.dialog.showMessageBox.mockRejectedValueOnce(new Error('dialog failed'));

    const first = winTools.attemptClose();
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    await flushMicrotasks();

    expect(state.closePromptOpen).toBe(false);
    expect(state.pendingClose).toBe(false);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('close guard dialog failed: dialog failed'));

    // A subsequent close attempt can open the dialog again.
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    winTools.attemptClose();
    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
  });

  it('quits when all windows close with no running export, or waits for cancel completion', () => {
    let active = false;
    const cancel = vi.fn();
    const { state, winTools } = makeState(() => active, cancel);

    handleWindowAllClosed(state);
    expect(harness.app.quit).toHaveBeenCalledTimes(1);

    harness.app.quit.mockClear();
    active = true;
    winTools.markDestroyed();
    handleWindowAllClosed(state);
    expect(harness.app.quit).not.toHaveBeenCalled();
    expect(state.pendingClose).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);

    active = false;
    handleExportDone(state, { status: 'canceled' });
    expect(state.pendingClose).toBe(false);
    expect(harness.app.quit).toHaveBeenCalledTimes(1);
  });
});

describe('renderer security headers', () => {
  it('enforces CSP and X-Content-Type-Options on app:// and devUrl responses only', () => {
    let listener: Parameters<HeaderSession['webRequest']['onHeadersReceived']>[0] | null = null;
    const targetSession: HeaderSession = {
      webRequest: {
        onHeadersReceived: (fn) => {
          listener = fn;
        },
      },
    };
    const csp = buildRendererCsp();
    installSecurityHeaders(targetSession, csp, 'http://localhost:3210');
    expect(listener).not.toBeNull();

    const appReply = vi.fn();
    listener!({ url: `${APP_ORIGIN}/index.html`, responseHeaders: { 'Content-Type': ['text/html'] } }, appReply);
    expect(appReply).toHaveBeenCalledWith({
      responseHeaders: {
        'Content-Type': ['text/html'],
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    });

    const devReply = vi.fn();
    listener!({ url: 'http://localhost:3210/', responseHeaders: {} }, devReply);
    expect(devReply).toHaveBeenCalledWith({
      responseHeaders: {
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    });

    const externalReply = vi.fn();
    listener!({ url: 'https://example.com/', responseHeaders: { Server: ['other'] } }, externalReply);
    expect(externalReply).toHaveBeenCalledWith({
      responseHeaders: { Server: ['other'] },
    });
  });
});

describe('installNavigationGuards (#398)', () => {
  function makeNavHarness(devUrl: string | null) {
    const listeners = new Map<'will-navigate' | 'will-redirect', (event: { preventDefault(): void }, url: string) => void>();
    const webContents: NavigationWebContents = {
      on: (event, listener) => {
        listeners.set(event, listener);
      },
    };
    installNavigationGuards(webContents, devUrl);
    return (eventName: 'will-navigate' | 'will-redirect', url: string) => {
      const listener = listeners.get(eventName);
      if (!listener) throw new Error(`missing listener for ${eventName}`);
      const event = { preventDefault: vi.fn() };
      listener(event, url);
      return event.preventDefault.mock.calls.length > 0;
    };
  }

  it.for(['will-navigate', 'will-redirect'] as const)(
    'allows APP_ORIGIN and blocks external or file targets on %s in production mode',
    (eventName) => {
      const blocked = makeNavHarness(null);
      expect(blocked(eventName, 'app://bundle/')).toBe(false);
      expect(blocked(eventName, 'app://bundle/index.html')).toBe(false);
      expect(blocked(eventName, 'file:///C:/evil.html')).toBe(true);
      expect(blocked(eventName, 'https://attacker.example/')).toBe(true);
      expect(blocked(eventName, 'http://localhost:3210/')).toBe(true);
      expect(blocked(eventName, 'app://bundle.evil/')).toBe(true);
      expect(blocked(eventName, 'data:text/html,evil')).toBe(true);
    },
  );

  it.for(['will-navigate', 'will-redirect'] as const)(
    'allows the loopback devUrl origin in dev mode and blocks other targets on %s',
    (eventName) => {
      const blocked = makeNavHarness('http://localhost:3210');
      expect(blocked(eventName, 'http://localhost:3210/')).toBe(false);
      expect(blocked(eventName, 'http://localhost:3210/editor')).toBe(false);
      expect(blocked(eventName, 'app://bundle/')).toBe(false);
      expect(blocked(eventName, 'http://localhost:9999/')).toBe(true);
      expect(blocked(eventName, 'http://localhost:3210.evil/')).toBe(true);
      expect(blocked(eventName, 'file:///C:/evil.html')).toBe(true);
    },
  );
});

describe('resolveDesktopConfig (#401)', () => {
  it('ignores .dronepath.json in process.cwd() and its ancestor directories', () => {
    const cwdRoot = tmpDir();
    const nestedCwd = path.join(cwdRoot, 'Downloads');
    fs.mkdirSync(nestedCwd, { recursive: true });
    fs.writeFileSync(
      path.join(cwdRoot, '.dronepath.json'),
      JSON.stringify({ ffmpeg: '/evil/parent-ffmpeg', browser: '/evil/parent-browser' }),
    );
    fs.writeFileSync(
      path.join(nestedCwd, '.dronepath.json'),
      JSON.stringify({ ffmpeg: '/evil/cwd-ffmpeg', ffprobe: '/evil/cwd-ffprobe' }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue(nestedCwd);

    const userRoot = tmpDir();
    const userDir = path.join(userRoot, 'drone-path');
    fs.mkdirSync(userDir, { recursive: true });
    // Even an ancestor of userDir must not be discovered.
    fs.writeFileSync(
      path.join(userRoot, '.dronepath.json'),
      JSON.stringify({ ffmpeg: '/evil/user-parent-ffmpeg' }),
    );

    const resolved = resolveDesktopConfig(userDir);
    expect(resolved.configPath).toBeNull();
    expect(resolved.config.ffmpeg).toBeNull();
    expect(resolved.config.ffprobe).toBeNull();
    expect(resolved.config.browser).toBeNull();
    expect(resolved.config.outDir).toBe(DEFAULT_CONFIG.outDir);
  });

  it('loads .dronepath.json only when placed directly inside userDataDir and keeps relative outDir', () => {
    const userDir = tmpDir();
    const userConfig = path.join(userDir, '.dronepath.json');
    fs.writeFileSync(userConfig, JSON.stringify({ style: 'topo', workers: 2 }));

    const omittedOutDir = resolveDesktopConfig(userDir);
    expect(omittedOutDir.configPath).toBe(userConfig);
    expect(omittedOutDir.config.style).toBe('topo');
    expect(omittedOutDir.config.workers).toBe(2);
    expect(omittedOutDir.config.outDir).toBe(DEFAULT_CONFIG.outDir);

    fs.writeFileSync(userConfig, JSON.stringify({ outDir: 'renders' }));
    expect(resolveDesktopConfig(userDir).config.outDir).toBe('renders');

    fs.writeFileSync(userConfig, JSON.stringify({ outDir: null }));
    expect(resolveDesktopConfig(userDir).config.outDir).toBeNull();
  });
});
