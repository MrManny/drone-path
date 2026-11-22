import path from 'node:path';

import { mimeFor } from 'drone-path-engine/assets';
import { MEDIA_PATH } from './appurls.js';
import type { MapStyle } from 'drone-path-engine/config';
import type { TileCoord } from 'drone-path-engine/plan';
import { parseTilePathname } from 'drone-path-engine/tilecache';

export interface AppRoutes {
  exportRoot: string;
  videoPath: string | null;
}

type AppAsset =
  | { kind: 'export'; filePath: string; mime: string }
  | { kind: 'video'; filePath: string }
  | {
      kind: 'tile';
      style: MapStyle;
      tile: TileCoord;
    }
  | { kind: 'not-found' };

export function resolveAppAsset(pathname: string, routes: AppRoutes): AppAsset {
  if (pathname === MEDIA_PATH) {
    return routes.videoPath
      ? { kind: 'video', filePath: routes.videoPath }
      : { kind: 'not-found' };
  }

  const tile = parseTilePathname(pathname);
  if (tile) {
    return { kind: 'tile', ...tile };
  }

  return exportFile(pathname, routes.exportRoot);
}

function exportFile(pathname: string, exportRoot: string): AppAsset {
  let rel = pathname.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  // Windows drive prefixes or backslashes would be a plain file name to POSIX
  // resolution; refuse them so the guard works the same on every OS.
  if (rel.split('/').some((s) => s.includes('\\') || /^[a-zA-Z]:/.test(s))) {
    return { kind: 'not-found' };
  }
  const filePath = path.resolve(exportRoot, rel);
  const relCheck = path.relative(exportRoot, filePath);
  if (relCheck === '' || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return { kind: 'not-found' };
  }
  return {
    kind: 'export',
    filePath,
    mime: mimeFor(filePath),
  };
}
