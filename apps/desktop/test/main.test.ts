import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  net: {
    fetch: vi.fn(),
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
  net: harness.net,
  protocol: harness.protocol,
  session: harness.session,
  shell: { openExternal: vi.fn() },
}));

vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }));

import {
  handleRequest,
  installCloseGuard,
  installNavigationGuards,
  installSecurityHeaders,
  pickRecording,
  resolveDesktopConfig,
} from '../app/main.mjs';
import { showDialogWithParent } from '../app/shell.mjs';
import { APP_ORIGIN } from '../shared/appurls.js';
import { emptyAppState } from '../src/appstate.js';
import { buildRendererCsp } from '../src/securityheaders.js';
import { createShellController } from '../src/shellcontroller.js';
import type { HeaderSession, NavigationWebContents, ShellWindow } from '../src/shellcontroller.js';
import { createAppStateStore, readAppState } from '../src/shellio.js';

function makeWindow() {
  let closeHandler: ((e: { preventDefault(): void }) => void) | null = null;
  let destroyed = false;
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const win: ShellWindow = {
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

function makeHarness(running: () => boolean, cancel = vi.fn()) {
  const log = (msg: string) => process.stderr.write(`[drone-path] ${msg}\n`);
  const stateFile = path.join(tmpDir(), 'state.json');
  const controller = createShellController({
    config: DEFAULT_CONFIG,
    stateStore: createAppStateStore(stateFile, log),
    systemLanguages: ['en-US'],
    dirExists: (dirPath) => fs.existsSync(dirPath),
    confirmStopExport: async (win, t) => {
      const box = {
        type: 'warning' as const,
        buttons: [t('native.stopExport'), t('native.keepExporting')],
        defaultId: 1,
        cancelId: 1,
        message: t('native.exportInProgress'),
        detail: t('native.closeExportDetail'),
      };
      const { response } = await showDialogWithParent(
        win,
        harness.dialog.showMessageBox as (...args: unknown[]) => Promise<{ response: number }>,
        box,
      );
      return response === 0;
    },
    quitApp: () => harness.app.quit(),
    log,
  });
  const winTools = makeWindow();
  controller.setWindow(winTools.win);
  controller.attachExportRunner({ start: vi.fn(), running, cancel });
  installCloseGuard(winTools.win, controller);
  return { controller, cancel, winTools };
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
    const { winTools } = makeHarness(() => false);
    const event = winTools.attemptClose();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('cancels a running export and closes once onDone arrives when Stop export is chosen', async () => {
    let active = true;
    const cancel = vi.fn();
    const { controller, winTools } = makeHarness(() => active, cancel);
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });

    const event = winTools.attemptClose();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(controller.closeGuard.isPromptOpen()).toBe(true);

    await flushMicrotasks();
    expect(controller.closeGuard.isPromptOpen()).toBe(false);
    expect(controller.closeGuard.isPendingClose()).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);

    active = false;
    controller.handleExportDone({ status: 'canceled' });
    expect(controller.closeGuard.isPendingClose()).toBe(false);
    expect(winTools.win.close).toHaveBeenCalledTimes(1);
    expect(winTools.sent).toEqual([{ channel: 'dronepath:export:done', payload: { status: 'canceled' } }]);
  });

  it('keeps the export running and leaves pendingClose false when Keep exporting is chosen', async () => {
    const cancel = vi.fn();
    const { controller, winTools } = makeHarness(() => true, cancel);
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });

    const event = winTools.attemptClose();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await flushMicrotasks();

    expect(controller.closeGuard.isPromptOpen()).toBe(false);
    expect(controller.closeGuard.isPendingClose()).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(winTools.win.close).not.toHaveBeenCalled();
  });

  it('closes cleanly without poisoning future close guards when an export finishes while the prompt is open', async () => {
    let active = true;
    const cancel = vi.fn();
    const { controller, winTools } = makeHarness(() => active, cancel);

    let resolveDialog!: (value: { response: number }) => void;
    harness.dialog.showMessageBox.mockImplementationOnce(
      () =>
        new Promise<{ response: number }>((resolve) => {
          resolveDialog = resolve;
        }),
    );

    const firstClose = winTools.attemptClose();
    expect(firstClose.preventDefault).toHaveBeenCalledTimes(1);
    expect(controller.closeGuard.isPromptOpen()).toBe(true);

    // Export completes while the confirmation prompt is still open.
    active = false;
    controller.handleExportDone({
      status: 'ok',
      summary: { video: 'a.mp4', out: 'out.mp4', status: 'ok', elapsedSec: 1, frames: 30, fps: '30' },
    });
    expect(controller.ipc.resolveKnownOutput({ out: 'out.mp4' })).toBe('out.mp4');
    expect(controller.closeGuard.isPendingClose()).toBe(false);
    expect(winTools.win.close).not.toHaveBeenCalled();

    // User clicks "Stop export" after the export has already settled.
    resolveDialog({ response: 0 });
    await flushMicrotasks();

    expect(controller.closeGuard.isPromptOpen()).toBe(false);
    expect(controller.closeGuard.isPendingClose()).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(winTools.win.close).toHaveBeenCalledTimes(1);

    // Future exports must still be protected by the close guard.
    active = true;
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    const secondClose = winTools.attemptClose();
    expect(secondClose.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
    expect(controller.closeGuard.isPromptOpen()).toBe(false);
  });

  it('ignores a second close attempt while the confirmation prompt is already open', async () => {
    const { winTools } = makeHarness(() => true);
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
    const { controller, winTools } = makeHarness(() => true);
    harness.dialog.showMessageBox.mockRejectedValueOnce(new Error('dialog failed'));

    const first = winTools.attemptClose();
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    await flushMicrotasks();

    expect(controller.closeGuard.isPromptOpen()).toBe(false);
    expect(controller.closeGuard.isPendingClose()).toBe(false);
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
    const { controller, winTools } = makeHarness(() => active, cancel);

    controller.closeGuard.onWindowAllClosed();
    expect(harness.app.quit).toHaveBeenCalledTimes(1);

    harness.app.quit.mockClear();
    active = true;
    winTools.markDestroyed();
    controller.closeGuard.onWindowAllClosed();
    expect(harness.app.quit).not.toHaveBeenCalled();
    expect(controller.closeGuard.isPendingClose()).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);

    active = false;
    controller.handleExportDone({ status: 'canceled' });
    expect(controller.closeGuard.isPendingClose()).toBe(false);
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

describe('handleRequest (#405)', () => {
  const csp = buildRendererCsp();

  function makeRequestController(videoPath: string | null = null) {
    const stateFile = path.join(tmpDir(), 'state.json');
    const controller = createShellController({
      config: DEFAULT_CONFIG,
      stateStore: createAppStateStore(stateFile, vi.fn()),
      systemLanguages: ['en-US'],
      dirExists: (dirPath) => fs.existsSync(dirPath),
      confirmStopExport: async () => false,
      quitApp: vi.fn(),
      log: vi.fn(),
    });
    if (videoPath !== null) {
      controller.attachSession({
        pick: vi.fn(),
        getSession: () => null,
        videoPath: () => videoPath,
        saveTrack: vi.fn(),
      });
    }
    return controller;
  }

  function mockFileFetch(): void {
    harness.net.fetch.mockImplementation(async (url: string) => {
      const data = fs.readFileSync(fileURLToPath(url));
      return new Response(data);
    });
  }

  it('streams full, ranged, and 416 video responses with security headers', async () => {
    const root = tmpDir();
    const videoFile = path.join(tmpDir(), 'flight.mp4');
    fs.writeFileSync(videoFile, '0123456789abcdef');
    const controller = makeRequestController(videoFile);
    const tileTraffic = { ensure: vi.fn() };

    const full = await handleRequest(
      controller,
      tileTraffic,
      new Request(`${APP_ORIGIN}/media/video`),
      csp,
      root,
    );
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-length')).toBe('16');
    expect(full.headers.get('content-security-policy')).toBe(csp);
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await full.text()).toBe('0123456789abcdef');

    const partial = await handleRequest(
      controller,
      tileTraffic,
      new Request(`${APP_ORIGIN}/media/video`, { headers: { range: 'bytes=2-5' } }),
      csp,
      root,
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/16');
    expect(partial.headers.get('content-length')).toBe('4');
    expect(partial.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await partial.text()).toBe('2345');

    const unsatisfiable = await handleRequest(
      controller,
      tileTraffic,
      new Request(`${APP_ORIGIN}/media/video`, { headers: { range: 'bytes=100-200' } }),
      csp,
      root,
    );
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get('content-range')).toBe('bytes */16');
    expect(unsatisfiable.headers.get('content-security-policy')).toBe(csp);
    expect(await unsatisfiable.text()).toBe('range not satisfiable');
  });

  it('returns 404 when no video is loaded and rejects when the loaded file is missing on disk', async () => {
    const root = tmpDir();
    const tileTraffic = { ensure: vi.fn() };

    const noVideoRes = await handleRequest(
      makeRequestController(null),
      tileTraffic,
      new Request(`${APP_ORIGIN}/media/video`),
      csp,
      root,
    );
    expect(noVideoRes.status).toBe(404);
    expect(await noVideoRes.text()).toBe('not found');

    const missingFile = path.join(tmpDir(), 'deleted.mp4');
    await expect(
      handleRequest(
        makeRequestController(missingFile),
        tileTraffic,
        new Request(`${APP_ORIGIN}/media/video`),
        csp,
        root,
      ),
    ).rejects.toThrow();
  });

  it('serves cached or fetched map tiles via tileTraffic.ensure with image/png mime', async () => {
    const root = tmpDir();
    const tileFile = path.join(tmpDir(), 'tile.png');
    fs.writeFileSync(tileFile, 'png-bytes');
    mockFileFetch();
    const tileTraffic = { ensure: vi.fn(async () => tileFile) };

    const res = await handleRequest(
      makeRequestController(),
      tileTraffic,
      new Request(`${APP_ORIGIN}/tiles/satellite/12/34/56.png`),
      csp,
      root,
    );
    expect(tileTraffic.ensure).toHaveBeenCalledWith('satellite', { z: 12, x: 34, y: 56 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe(csp);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('png-bytes');
  });

  it('serves static export files and falls back to 404.html or plain 404 and 400 bad request', async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, '_next', 'static'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<html>ok</html>');
    fs.writeFileSync(path.join(root, '_next', 'static', 'app.js'), 'console.log(1);');
    mockFileFetch();
    const controller = makeRequestController();
    const tileTraffic = { ensure: vi.fn() };

    const indexRes = await handleRequest(controller, tileTraffic, new Request(`${APP_ORIGIN}/`), csp, root);
    expect(indexRes.status).toBe(200);
    expect(indexRes.headers.get('content-type')).toContain('text/html');
    expect(indexRes.headers.get('content-security-policy')).toBe(csp);
    expect(await indexRes.text()).toBe('<html>ok</html>');

    const jsRes = await handleRequest(
      controller,
      tileTraffic,
      new Request(`${APP_ORIGIN}/_next/static/app.js`),
      csp,
      root,
    );
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('text/javascript');
    expect(await jsRes.text()).toBe('console.log(1);');

    // Missing export and traversal requests fall back to plain 404 when 404.html does not exist.
    const missingRes = await handleRequest(
      controller,
      tileTraffic,
      new Request(`${APP_ORIGIN}/missing.html`),
      csp,
      root,
    );
    expect(missingRes.status).toBe(404);
    expect(missingRes.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await missingRes.text()).toBe('not found');

    const traversalRes = await handleRequest(
      controller,
      tileTraffic,
      new Request(`${APP_ORIGIN}/..%2Fsecret.txt`),
      csp,
      root,
    );
    expect(traversalRes.status).toBe(404);

    // When 404.html exists, notFound serves it with status 404 and HTML content type.
    fs.writeFileSync(path.join(root, '404.html'), '<h1>missing</h1>');
    const htmlNotFound = await handleRequest(
      controller,
      tileTraffic,
      new Request(`${APP_ORIGIN}/missing.html`),
      csp,
      root,
    );
    expect(htmlNotFound.status).toBe(404);
    expect(htmlNotFound.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(htmlNotFound.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await htmlNotFound.text()).toBe('<h1>missing</h1>');

    const badUrl = await handleRequest(
      controller,
      tileTraffic,
      new Request(`${APP_ORIGIN}/%E0%A4%A`),
      csp,
      root,
    );
    expect(badUrl.status).toBe(400);
    expect(badUrl.headers.get('content-security-policy')).toBe(csp);
    expect(await badUrl.text()).toBe('bad request');
  });
});

describe('pickRecording (#405)', () => {
  it('uses the live window, remembered folder, and localized labels and persists the picked directory', async () => {
    const existingDir = tmpDir();
    const stateFile = path.join(tmpDir(), 'state.json');
    const controller = createShellController({
      config: DEFAULT_CONFIG,
      appState: { ...emptyAppState(), lastOpenDir: existingDir, language: 'de' },
      stateStore: createAppStateStore(stateFile, vi.fn()),
      systemLanguages: ['en-US'],
      dirExists: (dirPath) => fs.existsSync(dirPath),
      confirmStopExport: async () => false,
      quitApp: vi.fn(),
      log: vi.fn(),
    });
    const { win } = makeWindow();
    controller.setWindow(win);

    const nextDir = tmpDir();
    const pickedFile = path.join(nextDir, 'DJI_0001.MP4');
    harness.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [pickedFile],
    });

    await expect(pickRecording(controller)).resolves.toBe(pickedFile);
    expect(harness.dialog.showOpenDialog).toHaveBeenCalledWith(win, {
      title: 'Drohnenaufnahme auswählen',
      filters: [{ name: 'DJI-Aufnahmen', extensions: ['mp4'] }],
      properties: ['openFile'],
      defaultPath: existingDir,
    });
    expect(readAppState(stateFile).lastOpenDir).toBe(nextDir);
  });

  it('omits missing parent/defaultPath and leaves lastOpenDir unchanged on cancel or empty selection', async () => {
    const missingDir = path.join(tmpDir(), 'gone');
    const stateFile = path.join(tmpDir(), 'state.json');
    const controller = createShellController({
      config: DEFAULT_CONFIG,
      appState: { ...emptyAppState(), lastOpenDir: missingDir },
      stateStore: createAppStateStore(stateFile, vi.fn()),
      systemLanguages: ['en-US'],
      dirExists: (dirPath) => fs.existsSync(dirPath),
      confirmStopExport: async () => false,
      quitApp: vi.fn(),
      log: vi.fn(),
    });
    const { win, markDestroyed } = makeWindow();
    controller.setWindow(win);
    markDestroyed();

    harness.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [path.join(tmpDir(), 'ignored.mp4')],
    });
    await expect(pickRecording(controller)).resolves.toBeNull();
    expect(harness.dialog.showOpenDialog).toHaveBeenCalledWith({
      title: 'Choose a drone recording',
      filters: [{ name: 'DJI recordings', extensions: ['mp4'] }],
      properties: ['openFile'],
      defaultPath: undefined,
    });
    expect(readAppState(stateFile).lastOpenDir).toBeNull();

    harness.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    await expect(pickRecording(controller)).resolves.toBeNull();
    expect(readAppState(stateFile).lastOpenDir).toBeNull();
  });
});
