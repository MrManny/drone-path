// Auto-update for the packaged desktop app: check the GitHub release feed,
// download in the background and let the UI prompt before the restart. Every
// failure stays a stderr line and never touches startup.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { app } from 'electron';
// The default import then destructuring keeps ESM consumers off the CJS named
// export interop (electron-builder issue #7976).
import electronUpdater from 'electron-updater';

import { errorMessage } from '../dist/errors.js';
import { shouldCheckForUpdates } from './update-policy.mjs';

const { autoUpdater } = electronUpdater;

export function initUpdates({ log, onReady }) {
  const hasUpdateMetadata = fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  if (!shouldCheckForUpdates({ packaged: app.isPackaged, hasUpdateMetadata })) return null;

  autoUpdater.autoDownload = true;
  // A postponed prompt must still install the update on the next regular quit.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => log(`update: ${message}`),
    warn: (message) => log(`update: ${message}`),
    error: (message) => log(`update: ${message}`),
  };
  // Feed and download failures are background noise: report and continue.
  autoUpdater.on('error', (e) => log(`update failed: ${errorMessage(e)}`));
  autoUpdater.on('update-downloaded', () => onReady());
  autoUpdater.checkForUpdates().catch((e) => log(`update check failed: ${errorMessage(e)}`));

  return {
    // electron-updater swallows install failures onto its 'error' event and
    // keeps running: both the thrown and the emitted failure must surface or
    // the restart prompt would wait forever.
    restart({ onError }) {
      const fail = (e) => {
        autoUpdater.removeListener('error', fail);
        onError(errorMessage(e));
      };
      autoUpdater.once('error', fail);
      try {
        autoUpdater.quitAndInstall(true, true);
      } catch (e) {
        fail(e);
        return { ok: false, error: errorMessage(e) };
      }
      return { ok: true };
    },
  };
}
