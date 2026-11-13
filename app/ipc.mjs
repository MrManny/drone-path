// IPC for the app window: handlers throw plain Errors and the handle()
// envelope answers the renderer with { ok: false, error }.

import fs from 'node:fs';
import path from 'node:path';

import { dialog, ipcMain, shell } from 'electron';

import { parsePickRequest, parseTelemetrySaveRequest } from '../dist/appsession.js';
import { applyAppState, writeAppState } from '../dist/appstate.js';
import { APP_ORIGIN, appStateFile } from '../dist/apppaths.js';
import { parseExportRequest, parseSettingsPatch } from '../dist/config.js';
import { ERR_NO_RECORDING, errorMessage } from '../dist/errors.js';
import { videoBaseName } from '../dist/recordings.js';
import { outputPathFor } from '../dist/pipeline.js';

// Only this app's window may drive the session state machine.
function assertTrusted(event, devUrl) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  const devOk = devUrl !== null && url.startsWith(devUrl);
  if (!url.startsWith(APP_ORIGIN + '/') && !devOk) {
    throw new Error('untrusted ipc sender');
  }
}

function handle(devUrl, channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    // Outside the envelope: an untrusted sender must see a rejected promise,
    // never a well-formed reply.
    assertTrusted(event, devUrl);
    try {
      return await fn(...args);
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  });
}

function requireVideo(state) {
  const video = state.session ? state.session.videoPath() : null;
  if (!video) throw new Error(ERR_NO_RECORDING);
  return video;
}

// The reveal/open guard: the renderer may only name a file this shell wrote
// (the last export or the last telemetry document, both set only by trusted
// handlers), never an arbitrary path.
function knownOutputOf(state, payload) {
  const out = payload && typeof payload === 'object' ? payload.out : null;
  if (typeof out !== 'string' || (out !== state.lastExportOut && out !== state.lastTelemetryOut)) {
    throw new Error('unknown output');
  }
  return out;
}

// The native dialog confirmed the name as typed, but the extension may have
// been appended after it: re-check the final path on every platform so an
// existing file is never replaced without a confirmation.
async function confirmReplace(state, chosen) {
  if (!fs.existsSync(chosen)) return true;
  const box = {
    type: 'warning',
    buttons: ['Replace', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Replace ${path.basename(chosen)}?`,
    detail: chosen,
  };
  const confirm = state.win
    ? await dialog.showMessageBox(state.win, box)
    : await dialog.showMessageBox(box);
  return confirm.response === 0;
}

// The CLI's default naming, with a relative out dir anchored at the
// recording: the app process has no meaningful working directory.
function exportDefaultFor(state, video) {
  const outDir = state.config.outDir
    ? path.resolve(path.dirname(video), state.config.outDir)
    : null;
  return outputPathFor(video, { ...state.config, outDir });
}

// Pure name rule for save dialogs: the typed name stands as typed when it
// already ends in the expected extension (any case); otherwise the extension
// is appended to it as typed, so "notes.csv" becomes "notes.csv.json". The
// dialogs that report the result show this final name, so the append is
// never silent.
export function resolveSavePath(typedPath, extension) {
  return typedPath.toLowerCase().endsWith(`.${extension}`)
    ? typedPath
    : `${typedPath}.${extension}`;
}

async function pickSavePath(state, { title, defaultPath, filters, extension }) {
  const options = { title, defaultPath, filters };
  const result = state.win
    ? await dialog.showSaveDialog(state.win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const chosen = resolveSavePath(result.filePath, extension);
  if (!(await confirmReplace(state, chosen))) return { ok: false, canceled: true };
  return { ok: true, path: chosen };
}

function registerSessionHandlers(state, devUrl) {
  handle(devUrl, 'dronepath:pick', (raw) => state.session.pick(parsePickRequest(raw)));
  handle(devUrl, 'dronepath:session', () => state.session.getSession());
}

function registerSettingsHandlers(state, devUrl, log) {
  handle(devUrl, 'dronepath:settings', () => state.config);
  handle(devUrl, 'dronepath:settings:save', (raw) => {
    const settings = parseSettingsPatch(raw, 'settings');
    state.appState = { ...state.appState, settings };
    state.config = applyAppState(state.config, state.appState);
    try {
      writeAppState(appStateFile(), state.appState);
    } catch (e) {
      // The look still applies when the state file cannot be written.
      log(`app state not saved: ${errorMessage(e)}`);
    }
    return { ok: true };
  });
}

function registerExportHandlers(state, devUrl) {
  handle(devUrl, 'dronepath:export:pick-output', async () => {
    const video = requireVideo(state);
    return pickSavePath(state, {
      title: 'Export video',
      defaultPath: exportDefaultFor(state, video),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      extension: 'mp4',
    });
  });
  handle(devUrl, 'dronepath:export:start', (raw) => {
    const video = requireVideo(state);
    state.exportRunner.start(video, parseExportRequest(raw, state.config));
    return { ok: true };
  });
  handle(devUrl, 'dronepath:export:cancel', () => {
    state.exportRunner.cancel();
    return { ok: true };
  });
  handle(devUrl, 'dronepath:export:reveal', (payload) => {
    shell.showItemInFolder(knownOutputOf(state, payload));
    return { ok: true };
  });
  handle(devUrl, 'dronepath:export:open', async (payload) => {
    const error = await shell.openPath(knownOutputOf(state, payload));
    return error ? { ok: false, error } : { ok: true };
  });
}

function registerTelemetryHandlers(state, devUrl, log) {
  handle(devUrl, 'dronepath:telemetry:pick-output', async () => {
    const video = requireVideo(state);
    // The export dialog's default folder, named after the recording
    // (<basename>.telemetry.json).
    const exportDefault = exportDefaultFor(state, video);
    return pickSavePath(state, {
      title: 'Export telemetry',
      defaultPath: path.join(path.dirname(exportDefault), `${videoBaseName(video)}.telemetry.json`),
      filters: [{ name: 'JSON document', extensions: ['json'] }],
      extension: 'json',
    });
  });
  handle(devUrl, 'dronepath:telemetry:save', (raw) => {
    requireVideo(state);
    const request = parseTelemetrySaveRequest(raw);
    state.session.saveTelemetryJson(request.outPath, request.range);
    state.lastTelemetryOut = request.outPath;
    log(`telemetry JSON: wrote ${request.outPath}`);
    return { ok: true };
  });
}

function registerUpdateHandlers(state, devUrl, sendToWindow) {
  handle(devUrl, 'dronepath:update:restart', () => {
    if (!state.updates) return { ok: false, error: 'this build does not self-update' };
    // No pendingClose here: the prompt never opens over a running export, and
    // a failed restart must not poison the export close guard.
    return state.updates.restart({
      onError: (message) => sendToWindow(state, 'dronepath:update:restart-failed', message),
    });
  });
  handle(devUrl, 'dronepath:update:state', () => ({ ready: state.updateReady }));
}

function registerWindowHandlers(state, devUrl) {
  handle(devUrl, 'dronepath:window:close', () => {
    // The window's close handler runs the running-export guard.
    if (state.win && !state.win.isDestroyed()) state.win.close();
  });
}

export function registerIpcHandlers(state, { devUrl, log, sendToWindow }) {
  registerSessionHandlers(state, devUrl);
  registerSettingsHandlers(state, devUrl, log);
  registerExportHandlers(state, devUrl);
  registerTelemetryHandlers(state, devUrl, log);
  registerUpdateHandlers(state, devUrl, sendToWindow);
  registerWindowHandlers(state, devUrl);
}
