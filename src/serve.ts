import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { resolveAsset } from './assets.js';
import type { AssetRoutes } from './assets.js';

const require_ = createRequire(import.meta.url);
const LEAFLET_DIR = path.dirname(require_.resolve('leaflet/dist/leaflet.js'));

export const RENDERER_DIR = fileURLToPath(new URL('./renderer/', import.meta.url));

export type ServeRoutes = Omit<AssetRoutes, 'leafletDir'>;

export function serveAsset(
  url: string,
  res: http.ServerResponse,
  routes: ServeRoutes,
): boolean {
  const asset = resolveAsset(url, { ...routes, leafletDir: LEAFLET_DIR });
  if (asset.kind === 'unrouted') return false;
  if (asset.kind === 'file') {
    let file = asset.filePath;
    if (!fs.existsSync(file) && asset.fallbackPath && fs.existsSync(asset.fallbackPath)) {
      file = asset.fallbackPath;
    }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': asset.mime });
      res.end(fs.readFileSync(file));
      return true;
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
  return true;
}
