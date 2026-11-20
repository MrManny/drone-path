import path from 'node:path';

import type { MapStyle } from './config.js';
import type { TileCoord } from './plan.js';
import { TILE_SOURCES } from './renderer/tilesources.js';

function cacheKeyFor(style: MapStyle): string {
  return TILE_SOURCES[style].cacheKey;
}

interface TileRef {
  style: MapStyle;
  tile: TileCoord;
}

export function parseTilePathname(pathname: string): TileRef | null {
  const m = /^\/tiles\/([a-z0-9_-]+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(pathname);
  if (!m) return null;
  const style = Object.hasOwn(TILE_SOURCES, m[1]) ? (m[1] as MapStyle) : null;
  return style === null
    ? null
    : { style, tile: { z: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } };
}

export function tilePaths(
  cacheDir: string,
  style: MapStyle,
  tile: TileCoord,
): { file: string; placeholder: string } {
  const dir = path.join(cacheDir, cacheKeyFor(style), String(tile.z), String(tile.x));
  return {
    file: path.join(dir, `${tile.y}.png`),
    placeholder: path.join(dir, `${tile.y}.placeholder.png`),
  };
}
