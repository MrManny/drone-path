import path from 'node:path';

import { userDataDir } from 'drone-path-engine/paths';

export const APP_ORIGIN = 'app://bundle';
export const MEDIA_PATH = '/media/video';
const MEDIA_URL = APP_ORIGIN + MEDIA_PATH;
export const TILE_BASE = APP_ORIGIN + '/tiles';

// The ?v= query names the file so a reload can never replay another recording's bytes from a URL-keyed cache.
export function mediaUrlFor(videoPath: string): string {
  return `${MEDIA_URL}?v=${encodeURIComponent(videoPath)}`;
}

export function uiExportRoot(shellDir: string): string {
  return path.join(shellDir, '..', 'ui', 'out');
}

export function appStateFile(): string {
  return path.join(userDataDir(), 'state.json');
}
