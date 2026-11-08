// URL and path layout for the desktop app: the custom-scheme vocabulary,
// build-artifact locations and the per-user state file have exactly one home.

import os from 'node:os';
import path from 'node:path';

export const APP_ORIGIN = 'app://bundle';
export const MEDIA_PATH = '/media/video';
export const MEDIA_URL = APP_ORIGIN + MEDIA_PATH;
export const TILE_BASE = APP_ORIGIN + '/tiles';

/** The media URL for one recording: the query names the file, so a reload
 * can never replay another recording's bytes from a URL-keyed cache. */
export function mediaUrlFor(videoPath: string): string {
  return `${MEDIA_URL}?v=${encodeURIComponent(videoPath)}`;
}

/** The Next.js static export (ui/out) next to the app shell directory. */
export function uiExportRoot(shellDir: string): string {
  return path.join(shellDir, '..', 'ui', 'out');
}

// The per-user data root (LOCALAPPDATA on Windows, the cache convention
// elsewhere): the tile cache and the state file share it, so one machine-local
// place holds everything the app keeps per user.
export function userDataDir(): string {
  const base = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), '.cache');
  return path.join(base, 'neo2-flightpath');
}

/** The per-user state file the desktop app restores its settings from. */
export function appStateFile(): string {
  return path.join(userDataDir(), 'state.json');
}
