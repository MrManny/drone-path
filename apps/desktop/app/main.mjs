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
import {
  APP_ORIGIN,
  appStateFile,
  isAllowedAppUrl,
  resolveDevUrl,
  uiExportRoot,
} from '../dist/apppaths.js';
import {
  applyAppState,
  emptyAppState,
  readAppState,
  rememberOpenedFile,
  saveAppStateSafely,
} from '../dist/appstate.js';
import { createAppSession } from '../dist/appsession.js';
import { CONFIG_FILE_NAME } from 'drone-path-engine/config';
import { resolveConfig } from 'drone-path-engine/configfile';
import { userDataDir } from 'drone-path-engine/paths';
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
import { createTileTraffic } from 'drone-path-engine/tiles';
import { registerIpcHandlers } from './ipc.mjs';
import { liveWindow, showDialogWithParent, translationFor } from './shell.mjs';
import { initUpdates } from './update.mjs';

const SCHEME = 'app';
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

// The one window's mutable state, created in startup() and handed to every
// stage as one object: the IPC handlers, the export runner callbacks and the
// window lifecycle handlers share it, so each writer (export completion, the
// close guard, window-all-closed) is a named handler instead of a nested
// closure over scattered module globals.
export function createShellState() {
  return {
    win: null,
    session: null,
    config: null,
    appState: emptyAppState(),
    systemLanguages: app.getPreferredSystemLanguages(),
    tileTraffic: null,
    // The one tile prefetch entry point every in-process lane drives.
    tilePrefetch: null,
    exportRunner: null,
    // The update controller, or null when this build cannot self-update.
    updates: null,
    // A downloaded update waits even if its announcement raced the renderer.
    updateReady: false,
    // The destinations of the last successful export and the last track
    // save: the only paths the renderer may reveal or open.
    lastExportOut: null,
    lastTrackOut: null,
    // The destinations most recently approved by native save dialogs.
    pendingExportOut: null,
    pendingTrackOut: null,
    closePromptOpen: false,
    pendingClose: false,
  };
}

async function pickRecording(state) {
  const t = translationFor(state);
  const options = {
    title: t('native.chooseRecording'),
    filters: [{ name: t('native.djiRecordings'), extensions: ['mp4'] }],
    properties: ['openFile'],
    // Back where the last recording came from, when that folder still exists.
    defaultPath: rememberedOpenDir(state) ?? undefined,
  };
  const result = await showDialogWithParent(state, dialog.showOpenDialog.bind(dialog), options);
  const picked = result.canceled ? null : result.filePaths[0];
  if (picked) rememberPicked(state, picked);
  return picked;
}

function rememberedOpenDir(state) {
  const dir = state.appState.lastOpenDir;
  return dir && fs.existsSync(dir) ? dir : undefined;
}

function rememberPicked(state, filePath) {
  state.appState = rememberOpenedFile(state.appState, filePath);
  saveAppStateSafely(appStateFile(), state.appState, log);
}

function fail(state, error) {
  const message = errorMessage(error);
  process.stderr.write(`${ERROR_PREFIX}${message}\n`);
  const locale = resolveLocale(state.appState.language, state.systemLanguages);
  const t = translator(locale);
  dialog.showErrorBox(t('app.title'), locale === DEFAULT_LOCALE
    ? message
    : t('native.startupFailure', { details: message }));
  app.quit();
}

function sendToWindow(state, channel, payload) {
  liveWindow(state)?.webContents.send(channel, payload);
}

export function handleExportDone(state, outcome) {
  if (outcome.status === 'ok') state.lastExportOut = outcome.summary.out;
  sendToWindow(state, 'dronepath:export:done', outcome);
  if (state.pendingClose) {
    state.pendingClose = false;
    const win = liveWindow(state);
    if (win) win.close();
    else app.quit();
  }
}

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
  return new Response(Readable.toWeb(stream), { status: plan.status, headers });
}

// net.fetch only sets request headers; wrapping the body gives the client
// the intended MIME and status.
async function fileResponse(filePath, mime, status = 200, csp = '') {
  const fetched = await net.fetch(pathToFileURL(filePath).toString());
  const headers = csp
    ? withResponseSecurityHeaders({ 'Content-Type': mime }, csp)
    : { 'Content-Type': mime };
  return new Response(fetched.body, { status, headers });
}

function notFound(csp) {
  const fallback = path.join(exportRoot, '404.html');
  return fs.existsSync(fallback)
    ? fileResponse(fallback, 'text/html; charset=utf-8', 404, csp)
    : new Response('not found', {
        status: 404,
        headers: withResponseSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }, csp),
      });
}

async function handleRequest(state, request, csp) {
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
    videoPath: state.session ? state.session.videoPath() : null,
  });
  switch (plan.kind) {
    case 'video':
      return videoResponse(request, plan.filePath, csp);
    case 'tile': {
      // Always through the tile traffic: it serves cached tiles immediately,
      // retries tiles whose earlier download failed (so they recover once
      // connectivity returns) and falls back to the placeholder.
      const file = await state.tileTraffic.ensure(plan.style, plan.tile);
      return fileResponse(file, 'image/png', 200, csp);
    }
    case 'export':
      if (fs.existsSync(plan.filePath)) return fileResponse(plan.filePath, plan.mime, 200, csp);
      return notFound(csp);
    case 'not-found':
      return notFound(csp);
  }
}

// Desktop never walks process.cwd() upward for .dronepath.json; only a
// config file placed inside the controlled userDataDir() is consulted, and
// relative outDir values stay relative so exportDefaultFor() anchors them at
// the recording folder.
export function resolveDesktopConfig(userDir = userDataDir()) {
  const candidate = path.join(userDir, CONFIG_FILE_NAME);
  const configPath = fs.existsSync(candidate) ? candidate : null;
  return resolveConfig({
    cwd: userDir,
    configPath,
    discover: false,
    resolveOutDir: false,
  });
}

// The backing services behind the window: tool check, config, tile cache and
// the recording session.
async function initServices(state) {
  state.appState = readAppState(appStateFile());
  const resolved = resolveDesktopConfig();
  state.config = applyAppState(resolved.config, state.appState);
  await requireFfmpegTools(resolveFfmpegTools(state.config));
  // One polite tile queue for the whole app: on-demand tiles and the export
  // prefetch share its request budget, and on-demand tiles the player needs
  // right now jump the queue.
  state.tileTraffic = createTileTraffic(state.config.tileCache, app.isPackaged ? app.getVersion() : undefined);
  state.tilePrefetch = (options) => state.tileTraffic.stream(options);
  state.session = createAppSession({
    config: state.config,
    pickFile: () => pickRecording(state),
    log,
    onPreparing: () => sendToWindow(state, 'dronepath:preparing'),
    onPrepareProgress: (progress) =>
      sendToWindow(state, 'dronepath:preparing:progress', progress),
  });
}

function initExportRunner(state) {
  state.exportRunner = createExportRunner({
    log,
    onCapture: (progress) =>
      sendToWindow(state, 'dronepath:export:capture', progress),
    onDone: (outcome) => handleExportDone(state, outcome),
    // An export warms tiles next to the live app: same queue, same budget.
    deps: { prefetchTiles: state.tilePrefetch },
  });
}

export function installSecurityHeaders(targetSession, csp, devUrl = null) {
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldApplySecurityHeaders(details.url, devUrl)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({ responseHeaders: applySecurityHeaders(details.responseHeaders ?? {}, csp) });
  });
}

function installProtocolHandler(state, csp) {
  protocol.handle(SCHEME, (request) =>
    handleRequest(state, request, csp).catch((e) => {
      log(`scheme error: ${errorMessage(e)}`);
      return new Response('internal error', {
        status: 500,
        headers: withResponseSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }, csp),
      });
    }),
  );
}

function ensureUiExport(devUrl) {
  if (devUrl === null && !fs.existsSync(path.join(exportRoot, 'index.html'))) {
    throw new Error('ui export missing; run "npm run build" first');
  }
}

export function installNavigationGuards(webContents, devUrl) {
  const guard = (event, url) => {
    if (!isAllowedAppUrl(url, devUrl)) event.preventDefault();
  };
  webContents.on('will-navigate', guard);
  webContents.on('will-redirect', guard);
}

function createWindow(state, devUrl) {
  // The in-app menu bar owns all workspace commands; a native Alt/F10 menu
  // would compete with it, so none is installed (Windows and Linux).
  Menu.setApplicationMenu(null);
  const t = translationFor(state);
  state.win = new BrowserWindow({
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
  state.win.on('closed', () => {
    state.win = null;
  });
  // Web links (e.g. in the user manual) open in the system browser, never in
  // a second app window.
  state.win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  installNavigationGuards(state.win.webContents, devUrl);
}

// Closing the window must not silently kill a running export and strand
// minutes of work; the user chooses between stopping and keeping it.
export function installCloseGuard(state) {
  state.win.on('close', (e) => {
    // A close already confirmed by the user, or with nothing running, passes.
    if (state.pendingClose || !state.exportRunner || !state.exportRunner.running()) return;
    if (state.closePromptOpen) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    state.closePromptOpen = true;
    const t = translationFor(state);
    const box = {
      type: 'warning',
      buttons: [t('native.stopExport'), t('native.keepExporting')],
      defaultId: 1,
      cancelId: 1,
      message: t('native.exportInProgress'),
      detail: t('native.closeExportDetail'),
    };
    void showDialogWithParent(state, dialog.showMessageBox.bind(dialog), box)
      .then(({ response }) => {
        state.closePromptOpen = false;
        if (response !== 0) return;
        // The export may have settled while the dialog was open; close
        // directly instead of setting pendingClose for an onDone that already ran.
        if (!state.exportRunner || !state.exportRunner.running()) {
          const win = liveWindow(state);
          if (win) win.close();
          else app.quit();
          return;
        }
        // Cancellation settles asynchronously: the close completes from the
        // job's onDone, never from a synchronous running() check.
        state.pendingClose = true;
        state.exportRunner.cancel();
      })
      .catch((err) => {
        log(`close guard dialog failed: ${errorMessage(err)}`);
      })
      .finally(() => {
        state.closePromptOpen = false;
      });
  });
}

async function loadUi(state, devUrl) {
  await state.win.loadURL(devUrl ?? `${APP_ORIGIN}/`);
}

// The window is the app: closing it quits. A still-running export delays the
// quit until its job has settled and cleaned up after itself.
export function handleWindowAllClosed(state) {
  if (state.exportRunner && state.exportRunner.running()) {
    state.pendingClose = true;
    state.exportRunner.cancel();
    return;
  }
  app.quit();
}

async function startup() {
  const state = createShellState();
  app.on('window-all-closed', () => handleWindowAllClosed(state));
  try {
    const devUrl = resolveDevUrl(process.argv, app.isPackaged);
    await initServices(state);
    initExportRunner(state);
    state.updates = initUpdates({
      log,
      onReady: () => {
        // Buffered: the cache fast path can announce before the renderer
        // subscribes, and the state handler replays it on mount.
        state.updateReady = true;
        sendToWindow(state, 'dronepath:update:ready');
      },
    });
    registerIpcHandlers(state, { devUrl, log, sendToWindow });
    ensureUiExport(devUrl);
    const csp = buildRendererCsp({
      devUrl,
      scriptHashes: devUrl !== null ? [] : collectExportScriptHashes(exportRoot),
    });
    installSecurityHeaders(session.defaultSession, csp, devUrl);
    installProtocolHandler(state, csp);
    createWindow(state, devUrl);
    installCloseGuard(state);
    await loadUi(state, devUrl);
  } catch (e) {
    fail(state, e);
  }
}

app.whenReady().then(startup);
