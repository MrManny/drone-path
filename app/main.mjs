#!/usr/bin/env node
// Electron shell for the Drone Path desktop app: window, native file
// dialog, the app:// scheme and process lifecycle only. All behavior lives in
// dist/ (compiled from src/), so the app and the CLI stay one code base.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, dialog, Menu, net, protocol, shell } from 'electron';

import { resolveAppAsset } from '../dist/appassets.js';
import { APP_ORIGIN, appStateFile, uiExportRoot } from '../dist/apppaths.js';
import {
  applyAppState,
  emptyAppState,
  readAppState,
  rememberOpenedFile,
  writeAppState,
} from '../dist/appstate.js';
import { createAppSession } from '../dist/appsession.js';
import { resolveConfig } from '../dist/configfile.js';
import { ERROR_PREFIX, errorMessage } from '../dist/errors.js';
import { createExportRunner } from '../dist/exportjob.js';
import { requireFfmpegTools } from '../dist/ffmpeg.js';
import { resolveFfmpegTools } from '../dist/ffmpeg-tools.js';
import { planByteRange } from '../dist/range.js';
import { createTileTraffic } from '../dist/tiles.js';
import { registerIpcHandlers } from './ipc.mjs';
import { initUpdates } from './update.mjs';

const SCHEME = 'app';
// --dev-url points the window at `next dev` (hot reload) instead of the
// built export; kept an argv flag so no cross-platform env helper is needed.
const devUrlIndex = process.argv.indexOf('--dev-url');
const DEV_URL = devUrlIndex >= 0 ? process.argv[devUrlIndex + 1] : null;
const DEV_MODE = DEV_URL !== null;
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
function createShellState() {
  return {
    win: null,
    session: null,
    config: null,
    appState: emptyAppState(),
    tileTraffic: null,
    // The one tile prefetch entry point every in-process lane drives.
    tilePrefetch: null,
    exportRunner: null,
    // The update controller, or null when this build cannot self-update.
    updates: null,
    // A downloaded update waits even if its announcement raced the renderer.
    updateReady: false,
    // The destinations of the last successful export and the last telemetry
    // JSON save: the only paths the renderer may reveal or open.
    lastExportOut: null,
    lastTelemetryOut: null,
    closePromptOpen: false,
    pendingClose: false,
  };
}

async function pickRecording(state) {
  const options = {
    title: 'Choose a drone recording',
    filters: [{ name: 'DJI recordings', extensions: ['mp4'] }],
    properties: ['openFile'],
    // Back where the last recording came from, when that folder still exists.
    defaultPath: rememberedOpenDir(state) ?? undefined,
  };
  const result = state.win
    ? await dialog.showOpenDialog(state.win, options)
    : await dialog.showOpenDialog(options);
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
  try {
    writeAppState(appStateFile(), state.appState);
  } catch (e) {
    // The pick and the look still apply when the state file cannot be written.
    log(`app state not saved: ${errorMessage(e)}`);
  }
}

function fail(error) {
  const message = errorMessage(error);
  process.stderr.write(`${ERROR_PREFIX}${message}\n`);
  dialog.showErrorBox('Drone Path', message);
  app.quit();
}

function sendToWindow(state, channel, payload) {
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send(channel, payload);
}

function handleExportDone(state, outcome) {
  if (outcome.status === 'ok') state.lastExportOut = outcome.summary.out;
  sendToWindow(state, 'dronepath:export:done', outcome);
  if (state.pendingClose) {
    state.pendingClose = false;
    if (state.win && !state.win.isDestroyed()) state.win.close();
    else app.quit();
  }
}

function videoResponse(request, filePath) {
  const size = fs.statSync(filePath).size;
  const plan = planByteRange(request.headers.get('range') ?? undefined, size, 'video/mp4');
  if (plan.status === 416) {
    return new Response(plan.body, { status: 416, headers: plan.headers });
  }
  const stream =
    plan.status === 206
      ? fs.createReadStream(filePath, { start: plan.span.start, end: plan.span.end })
      : fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), { status: plan.status, headers: plan.headers });
}

// net.fetch only sets request headers; wrapping the body gives the client
// the intended MIME and status.
async function fileResponse(filePath, mime, status = 200) {
  const fetched = await net.fetch(pathToFileURL(filePath).toString());
  return new Response(fetched.body, { status, headers: { 'Content-Type': mime } });
}

function notFound() {
  const fallback = path.join(exportRoot, '404.html');
  return fs.existsSync(fallback)
    ? fileResponse(fallback, 'text/html; charset=utf-8', 404)
    : new Response('not found', { status: 404 });
}

async function handleRequest(state, request) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const plan = resolveAppAsset(pathname, {
    exportRoot,
    tileCache: state.config.tileCache,
    videoPath: state.session ? state.session.videoPath() : null,
  });
  switch (plan.kind) {
    case 'video':
      return videoResponse(request, plan.filePath);
    case 'tile': {
      // Always through the tile traffic: it serves cached tiles immediately,
      // retries tiles whose earlier download failed (so they recover once
      // connectivity returns) and falls back to the placeholder.
      const file = await state.tileTraffic.ensure(plan.style, plan.tile);
      return fileResponse(file, 'image/png');
    }
    case 'export':
      if (fs.existsSync(plan.filePath)) return fileResponse(plan.filePath, plan.mime);
      return notFound();
    case 'not-found':
      return notFound();
  }
}

// The backing services behind the window: tool check, config, tile cache and
// the recording session.
async function initServices(state) {
  const resolved = resolveConfig({});
  state.appState = readAppState(appStateFile());
  state.config = applyAppState(resolved.config, state.appState);
  await requireFfmpegTools(resolveFfmpegTools(state.config));
  // One polite tile queue for the whole app: on-demand tiles and the export
  // prefetch share its request budget, and on-demand tiles the player needs
  // right now jump the queue.
  state.tileTraffic = createTileTraffic(state.config.tileCache);
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
    log: (msg) => {
      log(msg);
      sendToWindow(state, 'dronepath:export:progress', msg);
    },
    onCapture: (progress) =>
      sendToWindow(state, 'dronepath:export:capture', progress),
    onDone: (outcome) => handleExportDone(state, outcome),
    // An export warms tiles next to the live app: same queue, same budget.
    deps: { prefetchTiles: state.tilePrefetch },
  });
}

function installProtocolHandler(state) {
  protocol.handle(SCHEME, (request) =>
    handleRequest(state, request).catch((e) => {
      log(`scheme error: ${errorMessage(e)}`);
      return new Response('internal error', { status: 500 });
    }),
  );
}

function ensureUiExport() {
  if (!DEV_MODE && !fs.existsSync(path.join(exportRoot, 'index.html'))) {
    throw new Error('ui export missing; run "npm run build" first');
  }
}

function createWindow(state) {
  // The in-app menu bar owns all workspace commands; a native Alt/F10 menu
  // would compete with it, so none is installed (Windows and Linux).
  Menu.setApplicationMenu(null);
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
    title: 'Drone Path',
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
}

// Closing the window must not silently kill a running export and strand
// minutes of work; the user chooses between stopping and keeping it.
function installCloseGuard(state) {
  state.win.on('close', (e) => {
    // A close already confirmed by the user, or with nothing running, passes.
    if (state.pendingClose || !state.exportRunner || !state.exportRunner.running()) return;
    if (state.closePromptOpen) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    state.closePromptOpen = true;
    const box = {
      type: 'warning',
      buttons: ['Stop Export and Close', 'Keep Exporting'],
      defaultId: 1,
      cancelId: 1,
      message: 'An export is in progress',
      detail: 'Closing the window stops the export and removes its unfinished file.',
    };
    void (state.win ? dialog.showMessageBox(state.win, box) : dialog.showMessageBox(box)).then(
      ({ response }) => {
        state.closePromptOpen = false;
        if (response !== 0) return;
        // Cancellation settles asynchronously: the close completes from the
        // job's onDone, never from a synchronous running() check.
        state.pendingClose = true;
        state.exportRunner.cancel();
      },
    );
  });
}

async function loadUi(state) {
  await state.win.loadURL(DEV_MODE ? DEV_URL : `${APP_ORIGIN}/`);
}

// The window is the app: closing it quits. A still-running export delays the
// quit until its job has settled and cleaned up after itself.
function handleWindowAllClosed(state) {
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
    registerIpcHandlers(state, { devUrl: DEV_URL, log, sendToWindow });
    installProtocolHandler(state);
    ensureUiExport();
    createWindow(state);
    installCloseGuard(state);
    await loadUi(state);
  } catch (e) {
    fail(e);
  }
}

app.whenReady().then(startup);
