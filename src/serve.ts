import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { mimeFor, resolveAsset } from './assets.js';
import type { AssetRoutes } from './assets.js';
import { rangePlan } from './range.js';

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

export function serveFileWithRange(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
): Promise<void> {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return Promise.resolve();
  }
  const mime = mimeFor(filePath);
  const plan = rangePlan(req.headers['range'], size, mime);
  res.writeHead(plan.status, plan.headers);
  if (plan.status === 416) {
    res.end(plan.body);
    return Promise.resolve();
  }
  if (req.method === 'HEAD') {
    res.end();
    return Promise.resolve();
  }
  const stream =
    plan.status === 206
      ? fs.createReadStream(filePath, { start: plan.span.start, end: plan.span.end })
      : fs.createReadStream(filePath);
  return new Promise<void>((resolve) => {
    pipeline(stream, res, () => resolve());
  });
}
