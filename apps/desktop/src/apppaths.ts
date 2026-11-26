import path from 'node:path';

import { userDataDir } from 'drone-path-engine/paths';

export function uiExportRoot(shellDir: string): string {
  return path.join(shellDir, '..', 'ui', 'out');
}

export function appStateFile(): string {
  return path.join(userDataDir(), 'state.json');
}

export function archivePosterCacheDir(): string {
  return path.join(userDataDir(), 'cache', 'posters');
}
