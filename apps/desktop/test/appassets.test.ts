import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveAppAsset } from '../src/appassets.js';
import type { AppRoutes } from '../src/appassets.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';
import { afterEach } from 'vitest';

function routes(overrides: Partial<AppRoutes> = {}): AppRoutes {
  const root = tmpDir();
  return {
    exportRoot: path.join(root, 'out'),
    videoPath: null,
    ...overrides,
  };
}

afterEach(cleanupTmpDirs);

describe('resolveAppAsset (export files)', () => {
  it.for([
    { name: 'root', pathname: '/', rel: 'index.html' },
    { name: 'explicit index', pathname: '/index.html', rel: 'index.html' },
    { name: 'client route', pathname: '/watch/', rel: path.join('watch', 'index.html') },
    { name: 'static chunk', pathname: '/_next/static/x.js', rel: path.join('_next', 'static', 'x.js') },
  ])('maps $name to its export file', ({ pathname, rel }) => {
    const r = routes();
    const asset = resolveAppAsset(pathname, r);
    expect(asset.kind).toBe('export');
    if (asset.kind === 'export') {
      expect(asset.filePath).toBe(path.join(r.exportRoot, rel));
    }
  });

  it('serves an HTML mime for pages and JS for chunks', () => {
    const html = resolveAppAsset('/index.html', routes());
    const js = resolveAppAsset('/_next/static/x.js', routes());
    expect(html.kind === 'export' && html.mime).toContain('text/html');
    expect(js.kind === 'export' && js.mime).toContain('text/javascript');
  });

  it.for([
    { name: 'parent traversal', pathname: '/../secret.txt' },
    { name: 'nested traversal', pathname: '/a/../../secret.txt' },
    { name: 'absolute path escape', pathname: '/C:/secret.txt' },
    { name: 'backslash traversal', pathname: '/..\\secret.txt' },
    { name: 'drive prefix mid-path', pathname: '/a/C:/secret.txt' },
    { name: 'backslash separators', pathname: '/a\\b.js' },
  ])('refuses $name', ({ pathname }) => {
    expect(resolveAppAsset(pathname, routes()).kind).toBe('not-found');
  });
});

describe('resolveAppAsset (tiles)', () => {
  it.for(['satellite', 'topo'] as const)('parses a %s tile request', (style) => {
    const asset = resolveAppAsset(`/tiles/${style}/1/2/3.png`, routes());
    expect(asset).toEqual({ kind: 'tile', style, tile: { z: 1, x: 2, y: 3 } });
  });

  it('treats unknown tile styles and non-png tile paths as plain export paths', () => {
    const r = routes();
    expect(resolveAppAsset('/tiles/evil/1/2/3.png', r)).toEqual({
      kind: 'export',
      filePath: path.join(r.exportRoot, 'tiles', 'evil', '1', '2', '3.png'),
      mime: 'image/png',
    });
    expect(resolveAppAsset('/tiles/satellite/1/2/3.jpg', r).kind).toBe('export');
  });
});

describe('resolveAppAsset (video)', () => {
  it('maps /media/video to the loaded recording', () => {
    const asset = resolveAppAsset('/media/video', routes({ videoPath: '/x/y.mp4' }));
    expect(asset).toEqual({ kind: 'video', filePath: '/x/y.mp4' });
  });

  it('refuses video without a loaded recording', () => {
    expect(resolveAppAsset('/media/video', routes()).kind).toBe('not-found');
  });
});

describe('resolveAppAsset (archive posters)', () => {
  it('parses valid 16-to-64 lowercase hex poster ids', () => {
    const id16 = '0123456789abcdef';
    const id32 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const id64 = 'f'.repeat(64);
    expect(resolveAppAsset(`/archive/poster/${id16}`, routes())).toEqual({
      kind: 'poster',
      id: id16,
    });
    expect(resolveAppAsset(`/archive/poster/${id32}`, routes())).toEqual({
      kind: 'poster',
      id: id32,
    });
    expect(resolveAppAsset(`/archive/poster/${id64}`, routes())).toEqual({
      kind: 'poster',
      id: id64,
    });
  });

  it.for([
    { name: 'empty id', pathname: '/archive/poster/' },
    { name: 'short hex id', pathname: '/archive/poster/0123456789abcde' },
    { name: 'long hex id', pathname: `/archive/poster/${'a'.repeat(65)}` },
    { name: 'uppercase hex', pathname: '/archive/poster/0123456789ABCDEF' },
    { name: 'traversal', pathname: '/archive/poster/../secret' },
    { name: 'nested slash', pathname: '/archive/poster/0123456789abcdef/extra' },
    { name: 'extension suffix', pathname: '/archive/poster/0123456789abcdef.jpg' },
  ])('rejects $name', ({ pathname }) => {
    expect(resolveAppAsset(pathname, routes())).toEqual({ kind: 'not-found' });
  });
});
