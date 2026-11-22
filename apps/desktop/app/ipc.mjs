// IPC for the app window: handlers throw plain Errors and the handle()
// envelope answers the renderer with { ok: false, error }.

import fs from 'node:fs';
import path from 'node:path';

import { dialog, ipcMain, shell } from 'electron';

import { parsePickRequest, parseTrackSaveRequest } from '../dist/appsession.js';
import { applyAppState, saveAppStateSafely, writeAppState } from '../dist/appstate.js';
import { appStateFile, isAllowedAppUrl } from '../dist/apppaths.js';
import { parseExportRequest, parseSettingsPatch } from 'drone-path-engine/config';
import { isLocale, resolveLocale } from '../dist/desktop-i18n/messages.js';
import { ERR_NO_RECORDING, errorMessage } from 'drone-path-core/errors';
import { isRecord } from 'drone-path-core/validation';
import { videoBaseName } from 'drone-path-engine/recordings';
import { outputPathFor } from 'drone-path-engine/pipeline';
import { TRACK_FORMAT_VALUES } from 'drone-path-core/track-format';
import { liveWindow, showDialogWithParent, translationFor } from './shell.mjs';

// Only this app's window may drive the session state machine.
function assertTrusted(event, devUrl) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  if (!isAllowedAppUrl(url, devUrl)) {
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

// Query/void channels return raw payloads rather than { ok } envelopes, so
// unexpected throws reject the IPC promise instead of leaking { ok: false }.
function handleQuery(devUrl, channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrusted(event, devUrl);
    return await fn(...args);
  });
}

function requireVideo(state) {
  const video = state.session ? state.session.videoPath() : null;
  if (!video) throw new Error(ERR_NO_RECORDING);
  return video;
}

// The reveal/open guard: the renderer may only name a file this shell wrote
// (the last export or the last track file, both set only by trusted
// handlers), never an arbitrary path.
function knownOutputOf(state, payload) {
  const out = isRecord(payload) ? payload.out : null;
  if (typeof out !== 'string' || (out !== state.lastExportOut && out !== state.lastTrackOut)) {
    throw new Error('unknown output');
  }
  return out;
}

// The native dialog confirmed the name as typed, but the extension may have
// been appended after it: re-check the final path on every platform so an
// existing file is never replaced without a confirmation.
async function confirmReplace(state, chosen) {
  if (!fs.existsSync(chosen)) return true;
  const t = translationFor(state);
  const box = {
    type: 'warning',
    buttons: [t('native.replace'), t('native.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: t('native.replaceFile', { name: path.basename(chosen) }),
    detail: chosen,
  };
  const confirm = await showDialogWithParent(state, dialog.showMessageBox.bind(dialog), box);
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
// already ends in one of the accepted extensions (any case); otherwise the
// default extension is appended to it as typed, so "notes.csv" becomes
// "notes.csv.json". The dialogs that report the result show this final name,
// so the append is never silent.
export function resolveSavePath(typedPath, extensions, defaultExtension) {
  const lower = typedPath.toLowerCase();
  return extensions.some((extension) => lower.endsWith(`.${extension}`))
    ? typedPath
    : `${typedPath}.${defaultExtension}`;
}

async function pickSavePath(state, { title, defaultPath, filters, extensions, defaultExtension }) {
  const options = { title, defaultPath, filters };
  const result = await showDialogWithParent(state, dialog.showSaveDialog.bind(dialog), options);
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const chosen = resolveSavePath(result.filePath, extensions, defaultExtension);
  if (!(await confirmReplace(state, chosen))) return { ok: false, canceled: true };
  return { ok: true, path: chosen };
}

// The write guard: export:start and track:save may only write to the exact
// absolute path last approved through the corresponding native save dialog.
function consumePendingOutput(state, key, outPath) {
  const expected = state[key];
  state[key] = null;
  if (typeof expected !== 'string' || !path.isAbsolute(expected) || outPath !== expected) {
    throw new Error('output path was not approved by save dialog');
  }
  return expected;
}

function registerSessionHandlers(state, devUrl) {
  handle(devUrl, 'dronepath:pick', async (raw) => {
    const result = await state.session.pick(parsePickRequest(raw));
    if (result.ok) {
      state.pendingExportOut = null;
      state.pendingTrackOut = null;
    }
    return result;
  });
  handleQuery(devUrl, 'dronepath:session', () => state.session.getSession());
}

function registerSettingsHandlers(state, devUrl, log) {
  handleQuery(devUrl, 'dronepath:settings', () => state.config);
  handle(devUrl, 'dronepath:settings:save', (raw) => {
    const settings = parseSettingsPatch(raw, 'settings');
    state.appState = { ...state.appState, settings };
    state.config = applyAppState(state.config, state.appState);
    // The look still applies when the state file cannot be written.
    saveAppStateSafely(appStateFile(), state.appState, log);
    return { ok: true };
  });
}

function languageSettings(state) {
  const preference = isLocale(state.appState.language) ? state.appState.language : null;
  return { preference, locale: resolveLocale(preference, state.systemLanguages) };
}

function registerLanguageHandlers(state, devUrl) {
  handleQuery(devUrl, 'dronepath:language', () => languageSettings(state));
  handle(devUrl, 'dronepath:language:save', (preference) => {
    if (preference !== null && !isLocale(preference)) throw new Error('invalid app language');
    const appState = { ...state.appState, language: preference };
    writeAppState(appStateFile(), appState);
    state.appState = appState;
    return { ok: true, ...languageSettings(state) };
  });
}

function registerExportHandlers(state, devUrl) {
  handle(devUrl, 'dronepath:export:pick-output', async () => {
    state.pendingExportOut = null;
    const video = requireVideo(state);
    const t = translationFor(state);
    const result = await pickSavePath(state, {
      title: t('native.exportVideo'),
      defaultPath: exportDefaultFor(state, video),
      filters: [{ name: t('native.mp4Video'), extensions: ['mp4'] }],
      extensions: ['mp4'],
      defaultExtension: 'mp4',
    });
    if (result.ok) state.pendingExportOut = result.path;
    return result;
  });
  handle(devUrl, 'dronepath:export:start', (raw) => {
    const video = requireVideo(state);
    const request = parseExportRequest(raw, state.config);
    const approved = consumePendingOutput(state, 'pendingExportOut', request.outPath);
    state.exportRunner.start(video, { ...request, outPath: approved });
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

function registerTrackHandlers(state, devUrl, log) {
  handle(devUrl, 'dronepath:track:pick-output', async () => {
    state.pendingTrackOut = null;
    const video = requireVideo(state);
    // The export dialog's default folder, named after the recording
    // (<basename>.telemetry.json); the typed name selects the format by its
    // extension, with the telemetry document as the bare-name default.
    const exportDefault = exportDefaultFor(state, video);
    const t = translationFor(state);
    const result = await pickSavePath(state, {
      title: t('native.exportTelemetry'),
      defaultPath: path.join(path.dirname(exportDefault), `${videoBaseName(video)}.telemetry.json`),
      filters: [
        { name: t('native.telemetryJson'), extensions: ['json'] },
        { name: t('native.gpx'), extensions: ['gpx'] },
        { name: t('native.geojson'), extensions: ['geojson'] },
        { name: t('native.kml'), extensions: ['kml'] },
        { name: t('native.kmz'), extensions: ['kmz'] },
      ],
      extensions: [...TRACK_FORMAT_VALUES],
      defaultExtension: 'json',
    });
    if (result.ok) state.pendingTrackOut = result.path;
    return result;
  });
  handle(devUrl, 'dronepath:track:save', (raw) => {
    requireVideo(state);
    const request = parseTrackSaveRequest(raw);
    const approved = consumePendingOutput(state, 'pendingTrackOut', request.outPath);
    state.session.saveTrack(approved, request.range);
    state.lastTrackOut = approved;
    log(`track: wrote ${approved}`);
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
  handleQuery(devUrl, 'dronepath:update:state', () => ({ ready: state.updateReady }));
}

function registerWindowHandlers(state, devUrl) {
  handleQuery(devUrl, 'dronepath:window:close', () => {
    // The window's close handler runs the running-export guard.
    liveWindow(state)?.close();
  });
}

export function registerIpcHandlers(state, { devUrl, log, sendToWindow }) {
  registerSessionHandlers(state, devUrl);
  registerSettingsHandlers(state, devUrl, log);
  registerLanguageHandlers(state, devUrl);
  registerExportHandlers(state, devUrl);
  registerTrackHandlers(state, devUrl, log);
  registerUpdateHandlers(state, devUrl, sendToWindow);
  registerWindowHandlers(state, devUrl);
}
