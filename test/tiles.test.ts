import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTileTraffic, prefetchTiles } from '../src/tiles.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  cleanupTmpDirs();
});

function okFetch() {
  return vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
}

async function rejected(promise: Promise<unknown>): Promise<Error> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof Error)) {
    throw new Error(`expected an Error rejection, got ${String(error)}`);
  }
  return error;
}

function tileIndex(starts: string[], tile: { z: number; x: number; y: number }): number {
  return starts.findIndex((url) => {
    const segs = url.split('/').slice(-3).map(Number);
    return segs.includes(tile.z) && segs.includes(tile.x) && segs.includes(tile.y);
  });
}

const T0 = { z: 1, x: 0, y: 0 };
const T1 = { z: 1, x: 0, y: 1 };
const T2 = { z: 1, x: 0, y: 2 };
const T3 = { z: 1, x: 0, y: 3 };
const T4 = { z: 1, x: 0, y: 4 };

describe('createTileTraffic ensure', () => {
  it('downloads a missing tile into the cache and returns it', async () => {
    const dir = tmpDir();
    const fetchStub = okFetch();
    vi.stubGlobal('fetch', fetchStub);

    const file = await createTileTraffic(dir).ensure('satellite', { z: 1, x: 2, y: 3 });

    expect(file).toBe(path.join(dir, 'esri-imagery', '1', '2', '3.png'));
    expect(fs.existsSync(file)).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('writes a placeholder and serves it when the download fails', async () => {
    const dir = tmpDir();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const file = await createTileTraffic(dir).ensure('topo', { z: 1, x: 2, y: 3 });

    expect(file).toBe(path.join(dir, 'opentopomap', '1', '2', '3.placeholder.png'));
    expect(fs.existsSync(file)).toBe(true);
  });

  it('serves a cached tile without fetching', async () => {
    const dir = tmpDir();
    const cachePath = path.join(dir, 'esri-imagery', '1', '2', '3.png');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'cached');
    const fetchStub = okFetch();
    vi.stubGlobal('fetch', fetchStub);

    const file = await createTileTraffic(dir).ensure('satellite', { z: 1, x: 2, y: 3 });

    expect(file).toBe(cachePath);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('shares one download for concurrent requests of the same tile', async () => {
    const dir = tmpDir();
    const fetchStub = okFetch();
    vi.stubGlobal('fetch', fetchStub);
    const traffic = createTileTraffic(dir);

    const [a, b] = await Promise.all([
      traffic.ensure('satellite', { z: 1, x: 2, y: 3 }),
      traffic.ensure('satellite', { z: 1, x: 2, y: 3 }),
    ]);

    expect(a).toBe(b);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('paces request starts at 2.0 per second', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response(new Uint8Array([1]), { status: 200 });
      }),
    );
    const traffic = createTileTraffic(dir);

    const pending = [0, 1, 2, 3].map((y) => traffic.ensure('satellite', { z: 1, x: 0, y }));
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(pending);

    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });

  it('paces retries at the same polite rate', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response('nope', { status: 500 });
      }),
    );
    const traffic = createTileTraffic(dir);

    const pending = traffic.ensure('satellite', { z: 1, x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(3000);
    await pending;

    expect(starts.length).toBeGreaterThan(1);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });

  it('recovers on a later request after a failed download', async () => {
    const dir = tmpDir();
    const fetchStub = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const traffic = createTileTraffic(dir);

    const failed = await traffic.ensure('topo', { z: 1, x: 2, y: 3 });
    expect(failed).toContain('placeholder');

    const recovered = await traffic.ensure('topo', { z: 1, x: 2, y: 3 });
    expect(recovered).toBe(path.join(dir, 'opentopomap', '1', '2', '3.png'));
    expect(fs.existsSync(recovered)).toBe(true);
  });
});

describe('createTileTraffic stream', () => {
  it('settles every tile once and reports the full plan as its total', async () => {
    const dir = tmpDir();
    const cachePath = path.join(dir, 'esri-imagery', '1', '0', '0.png');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'cached');
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchStub);

    const onTile = vi.fn();
    const stats = await createTileTraffic(dir).stream({
      style: 'satellite',
      tiles: [T0, T1, T2],
      onTile,
    });

    expect(stats).toEqual({ downloaded: 1, failed: 1, total: 3 });
    expect(onTile).toHaveBeenCalledTimes(3);
    expect(onTile.mock.calls.flat().sort()).toEqual(['cached', 'downloaded', 'failed'].sort());
  });

  it('resolves without fetching when the plan is already cached', async () => {
    const dir = tmpDir();
    const cachePath = path.join(dir, 'esri-imagery', '1', '0', '0.png');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'cached');
    vi.stubGlobal('fetch', vi.fn());

    const stats = await createTileTraffic(dir).stream({ style: 'satellite', tiles: [T0] });

    expect(stats).toEqual({ downloaded: 0, failed: 0, total: 1 });
  });

  it('serves on-demand tiles ahead of the queued pre-warm', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const starts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        starts.push(url);
        return new Response(new Uint8Array([1]), { status: 200 });
      }),
    );
    const traffic = createTileTraffic(dir);

    const warm = traffic.stream({ style: 'satellite', tiles: [T0, T1, T2, T3] });
    const onDemand = traffic.ensure('satellite', T4);
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all([warm, onDemand]);

    expect(starts).toHaveLength(5);
    expect(tileIndex(starts, T4)).toBeLessThan(tileIndex(starts, T2));
  });

  it('keeps on-demand and pre-warm starts inside one 2.0/s budget', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response(new Uint8Array([1]), { status: 200 });
      }),
    );
    const traffic = createTileTraffic(dir);

    const warm = traffic.stream({ style: 'satellite', tiles: [T0, T1, T2] });
    const onDemand = [T3, T4].map((tile) => traffic.ensure('satellite', tile));
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all([warm, ...onDemand]);

    expect(starts).toHaveLength(5);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });

  it('drops queued and in-flight downloads when the pre-warm is canceled', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const starts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string, init: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            starts.push(url);
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    const traffic = createTileTraffic(dir);
    const controller = new AbortController();

    const warm = traffic.stream({
      style: 'satellite',
      tiles: [T0, T1, T2, T3],
      signal: controller.signal,
    });
    const warmFails = expect(warm).rejects.toThrow('tile download canceled');
    await vi.advanceTimersByTimeAsync(600);
    expect(starts).toHaveLength(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(3000);
    await warmFails;

    expect(starts).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, 'esri-imagery', '1', '0', '2.placeholder.png'))).toBe(
      false,
    );
  });

  it('downloads a canceled tile normally on the next request', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    const traffic = createTileTraffic(dir);
    const controller = new AbortController();

    const warm = traffic.stream({
      style: 'satellite',
      tiles: [T0, T1, T2],
      signal: controller.signal,
    });
    const warmFails = expect(warm).rejects.toThrow('tile download canceled');
    await vi.advanceTimersByTimeAsync(600);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await warmFails;

    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.stubGlobal('fetch', okFetch());
    const file = await traffic.ensure('satellite', T2);
    expect(file).toBe(path.join(dir, 'esri-imagery', '1', '0', '2.png'));
  });

  it('never hands a canceled stream\'s downloads to the next one', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const first = new AbortController();
    const fetchStub = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<Response>((resolve, reject) => {
          if (!first.signal.aborted) {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          } else {
            resolve(new Response(new Uint8Array([1]), { status: 200 }));
          }
        }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const traffic = createTileTraffic(dir);

    const warm = traffic.stream({
      style: 'satellite',
      tiles: [T0, T1, T2],
      signal: first.signal,
    });
    const warmFails = expect(warm).rejects.toThrow('tile download canceled');
    await vi.advanceTimersByTimeAsync(600);
    first.abort();

    const second = new AbortController();
    const pivoted = traffic.stream({
      style: 'satellite',
      tiles: [T0, T1, T2],
      signal: second.signal,
    });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pivoted).resolves.toEqual({ downloaded: 3, failed: 0, total: 3 });
    await warmFails;
  });

  it('rejects a stream whose signal is canceled before anything starts', async () => {
    const dir = tmpDir();
    const fetchStub = okFetch();
    vi.stubGlobal('fetch', fetchStub);
    const controller = new AbortController();
    controller.abort();

    const error = await rejected(
      createTileTraffic(dir).stream({
        style: 'satellite',
        tiles: [T0, T1],
        signal: controller.signal,
      }),
    );

    // toBe, not toThrow: the user-facing cancel wording is pinned byte-identical.
    expect(error.message).toBe('tile download canceled');
    expect(fetchStub).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, 'esri-imagery', '1', '0', '0.placeholder.png'))).toBe(
      false,
    );
  });
});

describe('prefetchTiles', () => {
  it('downloads missing tiles and marks failures with placeholders', async () => {
    const dir = tmpDir();
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchStub);

    const stats = await prefetchTiles({
      style: 'satellite',
      tiles: [T0, T1],
      cacheDir: dir,
    });

    expect(stats).toEqual({ downloaded: 1, failed: 1, total: 2 });
    expect(fs.existsSync(path.join(dir, 'esri-imagery', '1', '0', '0.png'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'esri-imagery', '1', '0', '1.placeholder.png'))).toBe(true);
  });

  it('does not fetch anything that is already cached', async () => {
    const dir = tmpDir();
    const cachePath = path.join(dir, 'esri-imagery', '1', '0', '0.png');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'cached');
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);

    const stats = await prefetchTiles({
      style: 'satellite',
      tiles: [T0],
      cacheDir: dir,
    });

    expect(stats).toEqual({ downloaded: 0, failed: 0, total: 1 });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('reports every settled tile, whether cached, downloaded or failed', async () => {
    const dir = tmpDir();
    const cachePath = path.join(dir, 'esri-imagery', '1', '0', '0.png');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'cached');
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
      .mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchStub);

    const onTile = vi.fn();
    await prefetchTiles({
      style: 'satellite',
      tiles: [T0, T1, T2],
      cacheDir: dir,
      onTile,
    });

    expect(onTile).toHaveBeenCalledTimes(3);
    expect(onTile.mock.calls.flat().sort()).toEqual(['cached', 'downloaded', 'failed'].sort());
  });

  it('reports the cached tiles on the all-cached fast path too', async () => {
    const dir = tmpDir();
    const cachePath = path.join(dir, 'esri-imagery', '1', '0', '0.png');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'cached');
    vi.stubGlobal('fetch', vi.fn());

    const onTile = vi.fn();
    const stats = await prefetchTiles({
      style: 'satellite',
      tiles: [T0],
      cacheDir: dir,
      onTile,
    });

    expect(stats).toEqual({ downloaded: 0, failed: 0, total: 1 });
    expect(onTile).toHaveBeenCalledTimes(1);
    expect(onTile).toHaveBeenCalledWith('cached');
  });
});

describe('cache write failures', () => {
  describe.for([
    {
      name: 'the cache directory cannot be created',
      breakCache: (dir: string): void => {
        fs.writeFileSync(path.join(dir, 'esri-imagery'), 'not a directory');
      },
    },
    {
      name: 'the tile file cannot be written',
      breakCache: (): void => {
        vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
          throw new Error('ENOSPC: no space left on device, write');
        });
      },
    },
  ])('$name', ({ breakCache }) => {
    it('fails the tile job with the cache error instead of retrying the download', async () => {
      const dir = tmpDir();
      breakCache(dir);
      const fetchStub = okFetch();
      vi.stubGlobal('fetch', fetchStub);
      const cachePath = path.join(dir, 'esri-imagery', '1', '2', '3.png');

      const error = await rejected(createTileTraffic(dir).ensure('satellite', { z: 1, x: 2, y: 3 }));

      expect(error.message).toMatch(/^cache write failed: /);
      expect(error.message).toContain(cachePath);
      expect(error.cause).toBeInstanceOf(Error);
      expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('surfaces the cache error through prefetchTiles', async () => {
      const dir = tmpDir();
      breakCache(dir);
      const fetchStub = okFetch();
      vi.stubGlobal('fetch', fetchStub);

      const error = await rejected(
        prefetchTiles({ style: 'satellite', tiles: [T0], cacheDir: dir }),
      );

      expect(error.message).toMatch(/^cache write failed: /);
      expect(fetchStub).toHaveBeenCalledTimes(1);
    });
  });

  it('fails the tile job with a cache error when the placeholder cannot be written either', async () => {
    const dir = tmpDir();
    const fetchStub = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchStub);
    const placeholder = path.join(dir, 'esri-imagery', '1', '2', '3.placeholder.png');
    fs.mkdirSync(placeholder, { recursive: true });

    const error = await rejected(createTileTraffic(dir).ensure('satellite', { z: 1, x: 2, y: 3 }));

    expect(error.message).toMatch(/^cache write failed: /);
    expect(error.message).toContain(placeholder);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
