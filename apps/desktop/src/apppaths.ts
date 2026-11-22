import path from 'node:path';

import { userDataDir } from 'drone-path-engine/paths';

export const APP_ORIGIN = 'app://bundle';
export const MEDIA_PATH = '/media/video';
const MEDIA_URL = APP_ORIGIN + MEDIA_PATH;
export const TILE_BASE = APP_ORIGIN + '/tiles';

const APP_URL = new URL(APP_ORIGIN);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseLoopbackDevUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (e) {
    throw new Error('invalid --dev-url: expected an http:// loopback URL', { cause: e });
  }
  if (
    url.protocol !== 'http:' ||
    url.username !== '' ||
    url.password !== '' ||
    !LOOPBACK_HOSTS.has(url.hostname)
  ) {
    throw new Error(`invalid --dev-url: expected an http:// loopback URL: ${raw}`);
  }
  return url.toString();
}

export function resolveDevUrl(argv: readonly string[], isPackaged: boolean): string | null {
  if (isPackaged) return null;
  let resolved: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dev-url') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('invalid --dev-url: missing URL');
      }
      resolved = parseLoopbackDevUrl(value);
      i++;
    } else if (arg.startsWith('--dev-url=')) {
      resolved = parseLoopbackDevUrl(arg.slice('--dev-url='.length));
    }
  }
  return resolved;
}

export function isAllowedAppUrl(rawUrl: string, devUrl: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.protocol === APP_URL.protocol && parsed.host === APP_URL.host) {
    return true;
  }
  if (devUrl === null) return false;
  try {
    const allowedDev = new URL(parseLoopbackDevUrl(devUrl));
    return parsed.origin === allowedDev.origin;
  } catch {
    return false;
  }
}

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
