#!/usr/bin/env node
// Electron shell for the Drone Path desktop app: window, native file
// dialog, the app:// scheme and process lifecycle only. All behavior lives in
// the desktop backend and shared engine.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, dialog, Menu, net, protocol, session, shell } from 'electron';

import { resolveAppAsset } from '../dist/appassets.js';
import { appStateFile, uiExportRoot } from '../dist/apppaths.js';
import { APP_ORIGIN, isAllowedAppUrl, resolveDevUrl } from '../dist/appurls.js';
import { createAppSession } from '../dist/appsession.js';
import { DEFAULT_LOCALE, resolveLocale, translator } from '../dist/desktop-i18n/messages.js';
import { ERROR_PREFIX, errorMessage } from 'drone-path-core/errors';
import { createExportRunner } from '../dist/exportjob.js';
import { requireFfmpegTools } from 'drone-path-core/ffmpeg';
import { resolveFfmpegTools } from 'drone-path-core/ffmpeg-tools';
import { planByteRange } from 'drone-path-engine/range';
import {
  applySecurityHeaders,
  buildRendererCsp,
  collectExportScriptHashes,
  shouldApplySecurityHeaders,
  withResponseSecurityHeaders,
} from '../dist/securityheaders.js';
import { createShellController } from '../dist/shellcontroller.js';
import {
  createAppStateStore,
  nodeExportIo,
  nodeSessionIo,
  resolveDesktopConfig,
} from '../dist/shellio.js';
import { createTileTraffic } from 'drone-path-engine/tiles';
import { registerIpcHandlers } from './ipc.mjs';
import { showDialogWithParent } from './shell.mjs';
import { initUpdates } from './update.mjs';

export { resolveDesktopConfig };

/**
 * @typedef {import('../dist/shellcontroller.js').HeaderSession} HeaderSession
 * @typedef {import('../dist/shellcontroller.js').NavigationWebContents} NavigationWebContents
 * @typedef {import('../dist/shellcontroller.js').ShellController} ShellController
 * @typedef {import('../dist/shellcontroller.js').ShellWindow} ShellWindow
 * @typedef {import('../dist/desktop-i18n/messages.js').Locale} Locale
 * @typedef {import('../dist/desktop-i18n/messages.js').Translate} Translate
 */

const SCHEME = 'app';
/** @param {string} msg */
const log = (msg) => process.stderr.write(`[drone-path] ${msg}\n`);

// Must run before app ready so the scheme gets standard/secure semantics.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// Resolved against this script's directory (works in a checkout and in
// app.asar); app.getAppPath() does not point at the repo root when Electron
// is started with a script path.
const exportRoot = uiExportRoot(import.meta.dirname);

/**
 * @param {ShellController} controller
 * @returns {Promise<string | null>}
 */
async function pickRecording(controller) {
  const t = controller.translator();
  /** @type {Electron.OpenDialogOptions} */
  const options = {
    title: t('native.chooseRecording'),
    filters: [{ name: t('native.djiRecordings'), extensions: ['mp4'] }],
    properties: ['openFile'],
    // Back where the last recording came from, when that folder still exists.
    defaultPath: controller.rememberedOpenDir(),
  };
  const result = await showDialogWithParent(
    controller.liveWindow(),
    dialog.showOpenDialog.bind(dialog),
    options,
  );
  const picked = result.canceled ? null : (result.filePaths[0] ?? null);
  if (picked) controller.rememberPickedFile(picked);
  return picked;
}

/**
 * @param {ShellWindow | null} win
 * @param {Translate} t
 * @returns {Promise<boolean>}
 */
async function confirmStopExport(win, t) {
  /** @type {Electron.MessageBoxOptions} */
  const box = {
    type: 'warning',
    buttons: [t('native.stopExport'), t('native.keepExporting')],
    defaultId: 1,
    cancelId: 1,
    message: t('native.exportInProgress'),
    detail: t('native.closeExportDetail'),
  };
  const { response } = await showDialogWithParent(win, dialog.showMessageBox.bind(dialog), box);
  return response === 0;
}

/**
 * @param {Locale} locale
 * @param {unknown} error
 */
function fail(locale, error) {
  const message = errorMessage(error);
  process.stderr.write(`${ERROR_PREFIX}${message}\n`);
  const t = translator(locale);
  dialog.showErrorBox(
    t('app.title'),
    locale === DEFAULT_LOCALE ? message : t('native.startupFailure', { details: message }),
  );
  app.quit();
}

/**
 * @param {Request} request
 * @param {string} filePath
 * @param {string} csp
 * @returns {Response}
 */
function videoResponse(request, filePath, csp) {
  const size = fs.statSync(filePath).size;
  const plan = planByteRange(request.headers.get('range') ?? undefined, size, 'video/mp4');
  const headers = withResponseSecurityHeaders(plan.headers, csp);
  if (plan.status === 416) {
    return new Response(plan.body, { status: 416, headers });
  }
  const stream =
    plan.status === 206
      ? fs.createReadStream(filePath, { start: plan.span.start, end: plan.span.end })
      : fs.createReadStream(filePath);
  const body = /** @type {BodyInit} */ (/** @type {unknown} */ (Readable.toWeb(stream)));
  return new Response(body, { status: plan.status, headers });
}

// net.fetch only sets request headers; wrapping the body gives the client
// the intended MIME and status.
/**
 * @param {string} filePath
 * @param {string} mime
 * @param {number} [status]
 * @param {string} [csp]
 * @returns {Promise<Response>}
 */
async function fileResponse(filePath, mime, status = 200, csp = '') {
  const fetched = await net.fetch(pathToFileURL(filePath).toString());
  const headers = csp
    ? withResponseSecurityHeaders({ 'Content-Type': mime }, csp)
    : { 'Content-Type': mime };
  return new Response(fetched.body, { status, headers });
}

/**
 * @param {string} csp
 * @returns {Promise<Response> | Response}
 */
function notFound(csp) {
  const fallback = path.join(exportRoot, '404.html');
  return fs.existsSync(fallback)
    ? fileResponse(fallback, 'text/html; charset=utf-8', 404, csp)
    : new Response('not found', {
        status: 404,
        headers: withResponseSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }, csp),
      });
}

/**
 * @param {ShellController} controller
 * @param {ReturnType<typeof createTileTraffic>} tileTraffic
 * @param {Request} request
 * @param {string} csp
 * @returns {Promise<Response>}
 */
async function handleRequest(controller, tileTraffic, request, csp) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('bad request', {
      status: 400,
      headers: withResponseSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }, csp),
    });
  }
  const plan = resolveAppAsset(pathname, {
    exportRoot,
    videoPath: controller.videoPath(),
  });
  switch (plan.kind) {
    case 'video':
      return videoResponse(request, plan.filePath, csp);
    case 'tile': {
      // Always through the tile traffic: it serves cached tiles immediately,
      // retries tiles whose earlier download failed (so they recover once
      // connectivity returns) and falls back to the placeholder.
      const file = await tileTraffic.ensure(plan.style, plan.tile);
      return fileResponse(file, 'image/png', 200, csp);
    }
    case 'export':
      if (fs.existsSync(plan.filePath)) return fileResponse(plan.filePath, plan.mime, 200, csp);
      return notFound(csp);
    case 'not-found':
      return notFound(csp);
  }
}

// The backing services behind the window: tool check, config, tile cache and
// the recording session.
/**
 * @param {ShellController} controller
 * @returns {Promise<ReturnType<typeof createTileTraffic>>}
 */
async function initServices(controller) {
  const config = controller.getConfig();
  await requireFfmpegTools(resolveFfmpegTools(config));
  // One polite tile queue for the whole app: on-demand tiles and the export
  // prefetch share its request budget, and on-demand tiles the player needs
  // right now jump the queue.
  const tileTraffic = createTileTraffic(config.tileCache, app.isPackaged ? app.getVersion() : undefined);
  /** @type {(options: import('drone-path-engine/tiles').WarmOptions) => Promise<import('drone-path-engine/tiles').PrefetchStats>} */
  const tilePrefetch = (options) => tileTraffic.stream(options);
  controller.attachSession(
    createAppSession({
      config,
      pickFile: () => pickRecording(controller),
      io: nodeSessionIo,
      log,
      onPreparing: () => controller.sendToWindow('dronepath:preparing'),
      onPrepareProgress: (progress) =>
        controller.sendToWindow('dronepath:preparing:progress', progress),
    }),
  );
  controller.attachExportRunner(
    createExportRunner({
      io: nodeExportIo,
      log,
      onCapture: (progress) =>
        controller.sendToWindow('dronepath:export:capture', progress),
      onDone: (outcome) => controller.handleExportDone(outcome),
      // An export warms tiles next to the live app: same queue, same budget.
      deps: { prefetchTiles: tilePrefetch },
    }),
  );
  return tileTraffic;
}

/**
 * @param {HeaderSession} targetSession
 * @param {string} csp
 * @param {string | null} [devUrl]
 */
export function installSecurityHeaders(targetSession, csp, devUrl = null) {
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldApplySecurityHeaders(details.url, devUrl)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({ responseHeaders: applySecurityHeaders(details.responseHeaders ?? {}, csp) });
  });
}

/**
 * @param {ShellController} controller
 * @param {ReturnType<typeof createTileTraffic>} tileTraffic
 * @param {string} csp
 */
function installProtocolHandler(controller, tileTraffic, csp) {
  protocol.handle(SCHEME, (request) =>
    handleRequest(controller, tileTraffic, request, csp).catch((e) => {
      log(`scheme error: ${errorMessage(e)}`);
      return new Response('internal error', {
        status: 500,
        headers: withResponseSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }, csp),
      });
    }),
  );
}

/** @param {string | null} devUrl */
function ensureUiExport(devUrl) {
  if (devUrl === null && !fs.existsSync(path.join(exportRoot, 'index.html'))) {
    throw new Error('ui export missing; run "npm run build" first');
  }
}

/**
 * @param {NavigationWebContents} webContents
 * @param {string | null} devUrl
 */
export function installNavigationGuards(webContents, devUrl) {
  /**
   * @param {{ preventDefault(): void }} event
   * @param {string} url
   */
  const guard = (event, url) => {
    if (!isAllowedAppUrl(url, devUrl)) event.preventDefault();
  };
  webContents.on('will-navigate', guard);
  webContents.on('will-redirect', guard);
}

/**
 * @param {ShellController} controller
 * @param {string | null} devUrl
 * @returns {BrowserWindow}
 */
function createWindow(controller, devUrl) {
  // The in-app menu bar owns all workspace commands; a native Alt/F10 menu
  // would compete with it, so none is installed (Windows and Linux).
  Menu.setApplicationMenu(null);
  const t = controller.translator();
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    // The control bar needs ~1000px of min-content width; below this the
    // right-hand buttons would become unreachable.
    minWidth: 1024,
    minHeight: 600,
    // Match --page in ui/app/globals.css so startup shows one background.
    backgroundColor: '#232323',
    // The loaded page's <title> takes over after load (ui/app/layout.tsx).
    title: t('app.title'),
    // Windows renders an ICO best, Linux a PNG (Electron docs); both are
    // derived from build/icon-master.png (see build/README.md).
    icon:
      process.platform === 'win32'
        ? path.join(import.meta.dirname, '..', 'build', 'icon.ico')
        : path.join(import.meta.dirname, '..', 'build', 'icons', '256x256.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  controller.setWindow(win);
  win.on('closed', () => {
    controller.setWindow(null);
  });
  // Web links (e.g. in the user manual) open in the system browser, never in
  // a second app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  installNavigationGuards(win.webContents, devUrl);
  return win;
}

// Closing the window must not silently kill a running export and strand
// minutes of work; the user chooses between stopping and keeping it.
/**
 * @param {ShellWindow} win
 * @param {ShellController} controller
 */
export function installCloseGuard(win, controller) {
  win.on('close', (e) => controller.closeGuard.onWindowClose(e));
}

async function startup() {
  const systemLanguages = app.getPreferredSystemLanguages();
  const stateStore = createAppStateStore(appStateFile(), log);
  const initialAppState = stateStore.read();
  /** @type {ShellController | null} */
  let controller = null;
  // The window is the app: closing it quits. A still-running export delays the
  // quit until its job has settled and cleaned up after itself.
  app.on('window-all-closed', () => {
    if (controller) controller.closeGuard.onWindowAllClosed();
    else app.quit();
  });
  try {
    const devUrl = resolveDevUrl(process.argv, app.isPackaged);
    const resolved = resolveDesktopConfig();
    controller = createShellController({
      config: resolved.config,
      appState: initialAppState,
      stateStore,
      systemLanguages,
      dirExists: (dirPath) => fs.existsSync(dirPath),
      confirmStopExport,
      quitApp: () => app.quit(),
      log,
    });
    const tileTraffic = await initServices(controller);
    controller.attachUpdates(
      initUpdates({
        log,
        onReady: () => {
          // Buffered: the cache fast path can announce before the renderer
          // subscribes, and the state handler replays it on mount.
          controller?.markUpdateReady();
          controller?.sendToWindow('dronepath:update:ready');
        },
      }),
    );
    registerIpcHandlers(controller.ipc, { devUrl, log });
    ensureUiExport(devUrl);
    const csp = buildRendererCsp({
      devUrl,
      scriptHashes: devUrl !== null ? [] : collectExportScriptHashes(exportRoot),
    });
    installSecurityHeaders(session.defaultSession, csp, devUrl);
    installProtocolHandler(controller, tileTraffic, csp);
    const win = createWindow(controller, devUrl);
    installCloseGuard(win, controller);
    await win.loadURL(devUrl ?? `${APP_ORIGIN}/`);
  } catch (e) {
    const locale = controller
      ? controller.locale()
      : resolveLocale(initialAppState.language, systemLanguages);
    fail(locale, e);
  }
}

app.whenReady().then(startup);
