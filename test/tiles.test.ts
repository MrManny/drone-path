import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTileTraffic, prefetchTiles } from '../src/tiles.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanupTmpDirs();
});

function okFetch() {
  return vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
}

// The tile a recorded request was for, however the source orders its
// z/x/y segments in the URL.
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

// Busy-wait: only thread starvation can make a timer wake late, and fake
// timers cannot model that (a clock jump shifts pending deadlines along).
function stall(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // spin: the event loop stays blocked for the whole `ms`
  }
}

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

    expect(starts.length).toBeGreaterThan(1); // it retried
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

    // The placeholder must not pin the tile: the next request retries and
    // caches the real tile once the network is back.
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
    // Handle the rejection now: it settles at abort, before the test awaits.
    const warmFails = expect(warm).rejects.toThrow('tile download canceled');
    await vi.advanceTimersByTimeAsync(600);
    expect(starts).toHaveLength(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(3000);
    await warmFails;

    // The queued pair never fetched, and no canceled tile left a placeholder
    // that would stand in for the real tile on a later request.
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
    // Requests hang until their signal aborts (the canceled stream); once
    // the first stream is aborted, the replacement stream's requests succeed.
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

    // The pivot enqueues the overlapping plan while the canceled stream's
    // downloads are still winding down; it must run its own.
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
});

// Concurrent lanes (the app's gate pre-warm beside its warm stream, or an
// export beside the live player) must share the one queue's budget.
describe.for([
  { label: 'two warm streams', streams: 2, ensures: 0 },
  { label: 'two warm streams beside on-demand fetches', streams: 2, ensures: 2 },
])('createTileTraffic lanes: $label', ({ streams, ensures }) => {
  it('never starts two requests closer than 500 ms', async () => {
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
    const lanes: Promise<unknown>[] = [];
    for (let lane = 0; lane < streams; lane++) {
      lanes.push(
        traffic.stream({
          style: 'satellite',
          tiles: [
            { z: 3, x: lane, y: 0 },
            { z: 3, x: lane, y: 1 },
          ],
        }),
      );
    }
    for (let lane = 0; lane < ensures; lane++) {
      lanes.push(traffic.ensure('satellite', { z: 3, x: 9, y: lane }));
    }
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(lanes);

    expect(starts).toHaveLength(streams * 2 + ensures);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });
});

// A wake can land late when the event loop stalls, and the start after a
// late one is the threatened pair: a stale reserved slot used to start it
// early (444 ms gaps in the wild). late[k] is how late request k+1's wake
// lands past its target; the stall of request k's fetch starves that wake.
// Real timers with a spun stall model the jitter class faithfully.
describe.for<{ label: string; late: number[] }>([
  { label: 'punctual wakes', late: [0, 0, 0, 0] },
  { label: 'one +100 ms late wake', late: [100, 0, 0, 0] },
  { label: 'the observed +572 ms late wake', late: [572, 0, 0, 0] },
  { label: 'a burst of uneven late wakes', late: [100, 0, 572, 137] },
])('createTileTraffic late wakes: $label', ({ late }) => {
  it('keeps every actual request start 500 ms after the previous one', async () => {
    const dir = tmpDir();
    const starts: number[] = [];
    const stalls = late.map((l) => (l > 0 ? 500 + l : 0));
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        stall(stalls[call++] ?? 0);
        return new Response(new Uint8Array([1]), { status: 200 });
      }),
    );
    const traffic = createTileTraffic(dir);

    const jobs = Array.from({ length: late.length + 1 }, (_l, i) =>
      traffic.ensure('satellite', { z: 4, x: 0, y: i }),
    );
    await Promise.all(jobs);

    expect(starts).toHaveLength(late.length + 1);
    for (let i = 1; i < starts.length; i++) {
      // The gate's own interval, plus the lateness this wake suffered: the
      // start after a late one must not squeeze into the late one's interval.
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500 + late[i - 1]);
    }
  }, 20000);
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
