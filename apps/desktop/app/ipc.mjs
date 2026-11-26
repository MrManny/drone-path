// IPC for the app window: handlers throw plain Errors (coded where known) and
// the handle() envelope answers the renderer with { ok: false, code, detail?, params? }.

import fs from 'node:fs';
import path from 'node:path';

import { dialog, ipcMain, shell } from 'electron';

import { isAllowedAppUrl } from '../dist/shared/appurls.js';
import { resolveSavePath } from '../dist/outputguard.js';
import { classifyError } from '../dist/shared/errors.js';
import { ARCHIVE_EXPORT_FORMATS, IPC_INVOKE_CHANNELS } from '../dist/shared/ipc.js';
import { TRACK_FORMAT_VALUES } from 'drone-path-core/track-format';
import { showDialogWithParent } from './shell.mjs';

/**
 * @typedef {import('../dist/shellcontroller.js').IpcController} IpcController
 * @typedef {import('../dist/shared/desktop-i18n/messages.js').Translate} Translate
 * @typedef {{ devUrl: string | null; log: (message: string) => void }} IpcHandlersOptions
 */

// Only this app's window may drive the session state machine.
/**
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {string | null} devUrl
 */
function assertTrusted(event, devUrl) {
  const url = event.senderFrame?.url ?? '';
  if (!isAllowedAppUrl(url, devUrl)) {
    throw new Error('untrusted ipc sender');
  }
}

/**
 * @param {string | null} devUrl
 * @param {string} channel
 * @param {(...args: any[]) => unknown} fn
 */
function handle(devUrl, channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    // Outside the envelope: an untrusted sender must see a rejected promise,
    // never a well-formed reply.
    assertTrusted(event, devUrl);
    try {
      return await fn(...args);
    } catch (e) {
      return { ok: false, ...classifyError(e) };
    }
  });
}

// Query/void channels return raw payloads rather than { ok } envelopes, so
// unexpected throws reject the IPC promise instead of leaking { ok: false }.
/**
 * @param {string | null} devUrl
 * @param {string} channel
 * @param {(...args: any[]) => unknown} fn
 */
function handleQuery(devUrl, channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrusted(event, devUrl);
    return await fn(...args);
  });
}

// The native dialog confirmed the name as typed, but the extension may have
// been appended after it: re-check the final path on every platform so an
// existing file is never replaced without a confirmation.
/**
 * @param {IpcController} controller
 * @param {Translate} t
 * @param {string} chosen
 * @returns {Promise<boolean>}
 */
async function confirmReplace(controller, t, chosen) {
  if (!fs.existsSync(chosen)) return true;
  /** @type {Electron.MessageBoxOptions} */
  const box = {
    type: 'warning',
    buttons: [t('native.replace'), t('native.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: t('native.replaceFile', { name: path.basename(chosen) }),
    detail: chosen,
  };
  const confirm = await showDialogWithParent(
    controller.liveWindow(),
    dialog.showMessageBox.bind(dialog),
    box,
  );
  return confirm.response === 0;
}

/**
 * @param {IpcController} controller
 * @param {{
 *   title: string;
 *   defaultPath: string;
 *   filters: Electron.FileFilter[];
 *   extensions: readonly string[];
 *   defaultExtension: string;
 *   t: Translate;
 * }} params
 * @returns {Promise<{ ok: true; path: string } | { ok: false; canceled: true }>}
 */
async function pickSavePath(controller, { title, defaultPath, filters, extensions, defaultExtension, t }) {
  /** @type {Electron.SaveDialogOptions} */
  const options = { title, defaultPath, filters };
  const result = await showDialogWithParent(
    controller.liveWindow(),
    dialog.showSaveDialog.bind(dialog),
    options,
  );
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const chosen = resolveSavePath(result.filePath, extensions, defaultExtension);
  if (!(await confirmReplace(controller, t, chosen))) return { ok: false, canceled: true };
  return { ok: true, path: chosen };
}

/**
 * @param {IpcController} controller
 * @param {string | null} devUrl
 */
function registerSessionHandlers(controller, devUrl) {
  handle(devUrl, IPC_INVOKE_CHANNELS.pickRecording, (raw) => controller.pickRecording(raw));
  handleQuery(devUrl, IPC_INVOKE_CHANNELS.getSession, () => controller.getSession());
}

/**
 * @param {IpcController} controller
 * @param {string | null} devUrl
 */
function registerSettingsHandlers(controller, devUrl) {
  handleQuery(devUrl, IPC_INVOKE_CHANNELS.getSettings, () => controller.getSettings());
  handle(devUrl, IPC_INVOKE_CHANNELS.saveSettings, (raw) => {
    controller.saveSettings(raw);
    return { ok: true };
  });
}

/**
 * @param {IpcController} controller
 * @param {string | null} devUrl
 */
function registerLanguageHandlers(controller, devUrl) {
  handleQuery(devUrl, IPC_INVOKE_CHANNELS.getLanguage, () => controller.getLanguage());
  handle(devUrl, IPC_INVOKE_CHANNELS.saveLanguage, (preference) => ({
    ok: true,
    ...controller.saveLanguage(preference),
  }));
}

/**
 * @param {IpcController} controller
 * @param {string | null} devUrl
 */
function registerExportHandlers(controller, devUrl) {
  handle(devUrl, IPC_INVOKE_CHANNELS.pickExportOutput, async () => {
    const { defaultPath, t } = controller.beginExportPick();
    const result = await pickSavePath(controller, {
      title: t('native.exportVideo'),
      defaultPath,
      filters: [{ name: t('native.mp4Video'), extensions: ['mp4'] }],
      extensions: ['mp4'],
      defaultExtension: 'mp4',
      t,
    });
    if (result.ok) controller.approveExportOut(result.path);
    return result;
  });
  handle(devUrl, IPC_INVOKE_CHANNELS.startExport, (raw) => {
    controller.startExport(raw);
    return { ok: true };
  });
  handle(devUrl, IPC_INVOKE_CHANNELS.cancelExport, () => {
    controller.cancelExport();
    return { ok: true };
  });
  handle(devUrl, IPC_INVOKE_CHANNELS.revealExportOutput, (payload) => {
    shell.showItemInFolder(controller.resolveKnownOutput(payload));
    return { ok: true };
  });
  handle(devUrl, IPC_INVOKE_CHANNELS.openExportOutput, async (payload) => {
    const error = await shell.openPath(controller.resolveKnownOutput(payload));
    return error ? { ok: false, code: 'OPEN_FAILED', detail: error } : { ok: true };
  });
}

/**
 * @param {IpcController} controller
 * @param {string | null} devUrl
 * @param {(message: string) => void} log
 */
function registerTrackHandlers(controller, devUrl, log) {
  handle(devUrl, IPC_INVOKE_CHANNELS.pickTrackOutput, async () => {
    const { defaultPath, t } = controller.beginTrackPick();
    const result = await pickSavePath(controller, {
      title: t('native.exportTelemetry'),
      defaultPath,
      filters: [
        { name: t('native.telemetryJson'), extensions: ['json'] },
        { name: t('native.gpx'), extensions: ['gpx'] },
        { name: t('native.geojson'), extensions: ['geojson'] },
        { name: t('native.kml'), extensions: ['kml'] },
        { name: t('native.kmz'), extensions: ['kmz'] },
      ],
      extensions: [...TRACK_FORMAT_VALUES],
      defaultExtension: 'json',
      t,
    });
    if (result.ok) controller.approveTrackOut(result.path);
    return result;
  });
  handle(devUrl, IPC_INVOKE_CHANNELS.saveTrack, (raw) => {
    const approved = controller.saveTrack(raw);
    log(`track: wrote ${approved}`);
    return { ok: true };
  });
}

/**
 * @param {IpcController} controller
 * @param {string | null} devUrl
 */
function registerUpdateHandlers(controller, devUrl) {
  handle(devUrl, IPC_INVOKE_CHANNELS.restartToUpdate, () => controller.restartUpdate());
  handleQuery(devUrl, IPC_INVOKE_CHANNELS.getUpdateState, () => controller.getUpdateState());
}

/**
 * @param {IpcController} controller
 * @param {string | null} devUrl
 */
function registerWindowHandlers(controller, devUrl) {
  handleQuery(devUrl, IPC_INVOKE_CHANNELS.closeWindow, () => {
    // The window's close handler runs the running-export guard.
    controller.closeWindow();
  });
}

/**
 * @param {IpcController} controller
 * @param {string | null} devUrl
 * @param {(message: string) => void} log
 */
function registerArchiveHandlers(controller, devUrl, log) {
  handle(devUrl, IPC_INVOKE_CHANNELS.pickArchiveFolder, async () => {
    const t = controller.translator();
    /** @type {Electron.OpenDialogOptions} */
    const options = {
      title: t('native.chooseArchiveFolder'),
      properties: ['openDirectory'],
    };
    const result = await showDialogWithParent(
      controller.liveWindow(),
      dialog.showOpenDialog.bind(dialog),
      options,
    );
    const chosen = result.canceled ? null : (result.filePaths?.[0] ?? null);
    if (!chosen) return { ok: false, canceled: true };
    return { ok: true, ...controller.addArchiveRoot(chosen) };
  });
  handleQuery(devUrl, IPC_INVOKE_CHANNELS.listArchiveRoots, () => controller.listArchiveRoots());
  handle(devUrl, IPC_INVOKE_CHANNELS.removeArchiveRoot, (dir) => ({
    ok: true,
    roots: controller.removeArchiveRoot(dir),
  }));
  handle(devUrl, IPC_INVOKE_CHANNELS.scanArchive, async (roots) => ({
    ok: true,
    ...(await controller.scanArchive(roots)),
  }));
  handle(devUrl, IPC_INVOKE_CHANNELS.cancelArchiveScan, () => {
    controller.cancelArchiveScan();
    return { ok: true };
  });
  handleQuery(devUrl, IPC_INVOKE_CHANNELS.queryArchive, (filters) =>
    controller.queryArchive(filters),
  );
  handleQuery(devUrl, IPC_INVOKE_CHANNELS.findArchiveAtPoint, (point, radiusM, includeGaze) =>
    controller.findArchiveAtPoint(point, radiusM, includeGaze),
  );
  handle(devUrl, IPC_INVOKE_CHANNELS.openArchiveClip, (raw) => controller.openArchiveClip(raw));
  handle(devUrl, IPC_INVOKE_CHANNELS.revealArchiveClip, (clipPath) => {
    shell.showItemInFolder(controller.resolveArchiveClipForReveal(clipPath));
    return { ok: true };
  });
  handle(devUrl, IPC_INVOKE_CHANNELS.pickArchiveExportOutput, async (format) => {
    const { defaultPath, format: targetFormat, t } = controller.beginArchiveExportPick(format);
    const allFilters = [
      { id: 'gpx', name: t('native.gpx'), extensions: ['gpx'] },
      { id: 'geojson', name: t('native.geojson'), extensions: ['geojson'] },
      { id: 'kml', name: t('native.kml'), extensions: ['kml'] },
      { id: 'kmz', name: t('native.kmz'), extensions: ['kmz'] },
      { id: 'html', name: t('native.htmlMap'), extensions: ['html'] },
    ];
    const orderedFilters = [
      ...allFilters.filter((entry) => entry.id === targetFormat),
      ...allFilters.filter((entry) => entry.id !== targetFormat),
    ].map(({ name, extensions }) => ({ name, extensions }));
    const result = await pickSavePath(controller, {
      title: t('native.exportArchive'),
      defaultPath,
      filters: orderedFilters,
      extensions: [...ARCHIVE_EXPORT_FORMATS],
      defaultExtension: targetFormat,
      t,
    });
    if (result.ok) controller.approveArchiveExportOut(result.path);
    return result;
  });
  handle(devUrl, IPC_INVOKE_CHANNELS.exportArchive, (raw) => {
    const approved = controller.exportArchive(raw);
    log(`archive: wrote ${approved}`);
    return { ok: true };
  });
  handle(devUrl, IPC_INVOKE_CHANNELS.pruneArchiveOffline, () => ({
    ok: true,
    removed: controller.pruneArchiveOffline(),
  }));
}

/**
 * @param {IpcController} controller
 * @param {IpcHandlersOptions} options
 */
export function registerIpcHandlers(controller, { devUrl, log }) {
  registerSessionHandlers(controller, devUrl);
  registerSettingsHandlers(controller, devUrl);
  registerLanguageHandlers(controller, devUrl);
  registerExportHandlers(controller, devUrl);
  registerTrackHandlers(controller, devUrl, log);
  registerUpdateHandlers(controller, devUrl);
  registerWindowHandlers(controller, devUrl);
  registerArchiveHandlers(controller, devUrl, log);
}
