import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { MIME, resolveAsset } from './assets.js';
import type { AssetRoutes } from './assets.js';
import type { MapStyle } from './config.js';

const require_ = createRequire(import.meta.url);
const LEAFLET_DIR = path.dirname(require_.resolve('leaflet/dist/leaflet.js'));

export const RENDERER_DIR = fileURLToPath(new URL('./renderer/', import.meta.url));

type ServeRoutes = Omit<AssetRoutes, 'leafletDir'>;

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

export interface RenderServerHandle {
  server: http.Server;
  url: string;
}

// The render page and its assets on a loopback-only server: the page's
// absolute URLs (/leaflet, /renderer, /tiles) resolve exactly as in the
// browser the CLI drives, and in the app's embedded Chromium.
export function startRenderServer({
  html,
  style,
  tileCache,
}: {
  html: string;
  style: MapStyle;
  tileCache: string;
}): Promise<RenderServerHandle> {
  const server = http.createServer((req, res) => {
    let url: string;
    try {
      url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
      return;
    }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(html);
      return;
    }
    if (serveAsset(url, res, { style, tileCache, rendererDir: RENDERER_DIR })) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}
