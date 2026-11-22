import fs from 'node:fs';
import path from 'node:path';

import { errorMessage } from 'drone-path-core/errors';
import { writeTrackFile } from 'drone-path-core/track-write';
import { CONFIG_FILE_NAME } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import { resolveConfig } from 'drone-path-engine/configfile';
import { userDataDir } from 'drone-path-engine/paths';

import type { SessionIo } from './appsession.js';
import { emptyAppState, parseAppState, serializeAppState } from './appstate.js';
import type { AppState } from './appstate.js';
import type { ExportIo } from './exportjob.js';
import type { AppStateStore } from './shellcontroller.js';

export function readAppState(file: string): AppState {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return emptyAppState();
  }
  try {
    return parseAppState(JSON.parse(text));
  } catch {
    return emptyAppState();
  }
}

export function writeAppState(file: string, state: AppState): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serializeAppState(state));
  } catch (e) {
    throw new Error(`cannot write app state ${file}: ${errorMessage(e)}`, {
      cause: e,
    });
  }
}

export function saveAppStateSafely(
  file: string,
  state: AppState,
  log: (msg: string) => void,
): void {
  try {
    writeAppState(file, state);
  } catch (e) {
    log(`app state not saved: ${errorMessage(e)}`);
  }
}

export function createAppStateStore(
  file: string | (() => string),
  log: (msg: string) => void,
): AppStateStore {
  const pathOf = typeof file === 'function' ? file : () => file;
  return {
    read: () => readAppState(pathOf()),
    write: (state) => writeAppState(pathOf(), state),
    saveSafely: (state) => saveAppStateSafely(pathOf(), state, log),
  };
}

export const nodeSessionIo: SessionIo = {
  isFile(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  },
  writeTrack: writeTrackFile,
};

export const nodeExportIo: ExportIo = {
  exists: (filePath) => fs.existsSync(filePath),
  remove: (filePath) => fs.rmSync(filePath, { force: true }),
  rename: (from, to) => fs.renameSync(from, to),
};

// Desktop never walks process.cwd() upward for .dronepath.json; only a
// config file placed inside the controlled userDataDir() is consulted, and
// relative outDir values stay relative so exportDefaultFor() anchors them at
// the recording folder.
export function resolveDesktopConfig(
  userDir = userDataDir(),
): { config: RenderConfig; configPath: string | null } {
  const candidate = path.join(userDir, CONFIG_FILE_NAME);
  const configPath = fs.existsSync(candidate) ? candidate : null;
  return resolveConfig({
    cwd: userDir,
    configPath,
    discover: false,
    resolveOutDir: false,
  });
}
