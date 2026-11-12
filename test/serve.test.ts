import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { serveAsset } from '../src/serve.js';
import type { MapStyle } from '../src/config.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

interface Host {
  url: string;
  close(): Promise<void>;
}

async function startHost(
  tileCache: string,
  style: MapStyle = 'satellite',
  rendererDir: string = tmpDir(),
): Promise<Host> {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (serveAsset(url, res, { style, tileCache, rendererDir })) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function writeTile(tileCache: string, key: string, z: number, x: number, y: number, name: string): void {
  const dir = path.join(tileCache, key, String(z), String(x));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from('tile-bytes'));
}

afterEach(cleanupTmpDirs);

describe('serveAsset', () => {
  it('serves Leaflet assets from node_modules', async () => {
    const host = await startHost(tmpDir());
    try {
      const res = await fetch(`${host.url}/leaflet/leaflet.css`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/css');
      expect((await res.text()).length).toBeGreaterThan(0);
    } finally {
      await host.close();
    }
  });

  it('rejects Leaflet paths outside the asset whitelist', async () => {
    const host = await startHost(tmpDir());
    try {
      const res = await fetch(`${host.url}/leaflet/evil.txt`);
      expect(res.status).toBe(404);
    } finally {
      await host.close();
    }
  });

  it('serves cached tiles for the active style', async () => {
    const tileCache = tmpDir();
    writeTile(tileCache, 'esri-imagery', 1, 2, 3, '3.png');
    const host = await startHost(tileCache);
    try {
      const res = await fetch(`${host.url}/tiles/satellite/1/2/3.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/png');
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('tile-bytes');
    } finally {
      await host.close();
    }
  });

  it('falls back to the placeholder tile', async () => {
    const tileCache = tmpDir();
    writeTile(tileCache, 'esri-imagery', 4, 5, 6, '6.placeholder.png');
    const host = await startHost(tileCache);
    try {
      const res = await fetch(`${host.url}/tiles/satellite/4/5/6.png`);
      expect(res.status).toBe(200);
    } finally {
      await host.close();
    }
  });

  it('refuses tiles of a style that is not active', async () => {
    const tileCache = tmpDir();
    writeTile(tileCache, 'opentopomap', 1, 2, 3, '3.png');
    const host = await startHost(tileCache, 'satellite');
    try {
      const res = await fetch(`${host.url}/tiles/topo/1/2/3.png`);
      expect(res.status).toBe(404);
    } finally {
      await host.close();
    }
  });

  it('404s unknown URLs without claiming them', async () => {
    const host = await startHost(tmpDir());
    try {
      const res = await fetch(`${host.url}/other`);
      expect(res.status).toBe(404);
    } finally {
      await host.close();
    }
  });

  it('serves compiled renderer modules as JavaScript', async () => {
    const rendererDir = tmpDir();
    fs.writeFileSync(path.join(rendererDir, 'scene.js'), 'export const x = 1;');
    const host = await startHost(tmpDir(), 'satellite', rendererDir);
    try {
      const res = await fetch(`${host.url}/renderer/scene.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/javascript');
      expect(await res.text()).toBe('export const x = 1;');
    } finally {
      await host.close();
    }
  });

  it.for([
    { name: 'a missing module', url: '/renderer/gone.js' },
    { name: 'a path traversal', url: '/renderer/..%2Fsecret.js' },
    { name: 'a non-JavaScript file', url: '/renderer/scene.ts' },
  ])('refuses $name in /renderer/', async ({ url }) => {
    const rendererDir = tmpDir();
    fs.writeFileSync(path.join(rendererDir, 'scene.js'), 'export const x = 1;');
    const host = await startHost(tmpDir(), 'satellite', rendererDir);
    try {
      const res = await fetch(`${host.url}${url}`);
      expect(res.status).toBe(404);
    } finally {
      await host.close();
    }
  });
});

