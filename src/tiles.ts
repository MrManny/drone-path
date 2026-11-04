// The polite tile download policy in one home: every request start - retries
// included - is spaced REQUEST_INTERVAL_MS apart (2.0 req/s) and at most
// DOWNLOAD_WORKERS downloads run at once, whichever entry point drives them.
// createTileTraffic (the app: on-demand tiles and the background pre-warm on
// one queue) and prefetchTiles (the pipeline's bulk pre-warm) are thin
// wrappers whose priorities decide ordering and sharing.

import fs from 'node:fs';
import path from 'node:path';

import type { Style } from './config.js';
import { errorMessage } from './errors.js';
import type { TileCoord } from './plan.js';
import { solidPng } from './png.js';
import { tilePaths } from './tilecache.js';
import { TILE_SOURCES } from './renderer/tilesources.js';
import { VERSION } from './version.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const USER_AGENT = `neo2-flightpath/${VERSION} (flight-path map renderer; https://github.com/MrManny/neo2-flightpath)`;

const DOWNLOAD_ATTEMPTS = 2;
const DOWNLOAD_WORKERS = 2;
const REQUEST_INTERVAL_MS = 500;
const RETRY_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 20000;

// Politeness for the tile servers: every request start in one queue is spaced
// REQUEST_INTERVAL_MS apart (2.0 req/s), retries included, whichever queue
// drives them.
type RequestGate = () => Promise<void>;

function createRequestGate(): RequestGate {
  let nextSlotAt = 0;
  return async () => {
    const now = Date.now();
    const startAt = Math.max(now, nextSlotAt);
    nextSlotAt = startAt + REQUEST_INTERVAL_MS;
    if (startAt > now) await sleep(startAt - now);
  };
}

function tileUrl(style: Style, tile: TileCoord): string {
  const source = TILE_SOURCES[style];
  const subdomain = source.subdomains.length
    ? source.subdomains[(tile.x + tile.y) % source.subdomains.length]
    : '';
  return source.url
    .replace('{s}', subdomain)
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}

// A canceled download is not a failed one: no placeholder is written and the
// tile stays uncached, so a later request may fetch the real tile.
function canceled(signal: AbortSignal): Error {
  return new Error('tile download canceled', { cause: signal.reason });
}

// The network half of one tile: its body after a successful attempt, null
// when the attempts run out. The download retry is for network problems
// only; cache writes live in writeCacheFile and fail fast.
async function downloadTile(
  url: string,
  acquire: RequestGate,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
    await acquire();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), signal])
          : AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      if (signal?.aborted) throw canceled(signal);
      await sleep(RETRY_DELAY_MS);
    }
  }
  return null;
}

// An fs failure while writing the cache is the cache's fault, not the
// network's: it fails the tile's job instead of being retried as a download,
// and names the cache so the log and Open errors read it as a cache failure.
function writeCacheFile(cachePath: string, data: Buffer): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, data);
  } catch (e) {
    throw new Error(`cache write failed: ${cachePath}: ${errorMessage(e)}`, { cause: e });
  }
}

// Placeholder PNGs are pure derivations of the tile source's background
// color; memoizing per downloader keeps repeat failures cheap without any
// module-level mutable state.
function createPlaceholderSource(): (style: Style) => Buffer {
  const cache = new Map<Style, Buffer>();
  return (style) => {
    let png = cache.get(style);
    if (!png) {
      png = solidPng(TILE_SOURCES[style].placeholderBg);
      cache.set(style, png);
    }
    return png;
  };
}

export type TileStatus = 'cached' | 'downloaded' | 'failed';

export interface TileFetchResult {
  /** The file to serve: the real tile, or its placeholder after a failure. */
  file: string;
  status: TileStatus;
}

interface FetchContext {
  cacheDir: string;
  acquire: RequestGate;
  placeholderPng: (style: Style) => Buffer;
}

// The full cache dance for one tile: hit, download, or placeholder. The
// placeholder is served as a fallback so a missing tile is retried on a later
// run instead of being cached as missing.
async function fetchTileToCache(
  ctx: FetchContext,
  style: Style,
  tile: TileCoord,
  signal?: AbortSignal,
): Promise<TileFetchResult> {
  const paths = tilePaths(ctx.cacheDir, style, tile);
  if (fs.existsSync(paths.file)) return { file: paths.file, status: 'cached' };
  const body = await downloadTile(tileUrl(style, tile), ctx.acquire, signal);
  if (body) {
    writeCacheFile(paths.file, body);
    return { file: paths.file, status: 'downloaded' };
  }
  writeCacheFile(paths.placeholder, ctx.placeholderPng(style));
  return { file: paths.placeholder, status: 'failed' };
}

/**
 * A queued download's urgency: `now` serves the tile the player is looking at
 * and jumps the queue; `background` streams one plan's tiles behind it. The
 * two never share a download, so a canceled pre-warm cannot abort an
 * on-demand fetch.
 */
export type TilePriority = 'now' | 'background';

interface QueuedTile {
  style: Style;
  tile: TileCoord;
  signal?: AbortSignal;
  settle: (result: TileFetchResult) => void;
  fail: (error: unknown) => void;
  detach: () => void;
}

interface Downloader {
  enqueue(
    style: Style,
    tile: TileCoord,
    options?: { priority?: TilePriority; signal?: AbortSignal },
  ): Promise<TileFetchResult>;
}

interface InFlightEntry {
  promise: Promise<TileFetchResult>;
  /** Downloads are shared within one stream only: its abort decides their fate. */
  signal?: AbortSignal;
}

function createDownloader(
  cacheDir: string,
  placeholderPng: (style: Style) => Buffer,
): Downloader {
  const ctx: FetchContext = { cacheDir, acquire: createRequestGate(), placeholderPng };
  const inFlight = new Map<string, InFlightEntry>();
  const queue: QueuedTile[] = [];
  let active = 0;

  function pump(): void {
    while (active < DOWNLOAD_WORKERS) {
      const job = queue.shift();
      if (!job) break;
      if (job.signal?.aborted) {
        job.detach();
        job.fail(canceled(job.signal));
        continue;
      }
      active++;
      void (async () => {
        try {
          job.settle(await fetchTileToCache(ctx, job.style, job.tile, job.signal));
        } catch (e) {
          job.fail(e);
        } finally {
          job.detach();
          active--;
          pump();
        }
      })();
    }
  }

  return {
    enqueue(style, tile, options = {}): Promise<TileFetchResult> {
      const priority = options.priority ?? 'background';
      const key = `${priority}:${tilePaths(cacheDir, style, tile).file}`;
      // A canceled stream's downloads must never be handed to the next one:
      // sharing follows the abort signal of the download it joins.
      const shared = inFlight.get(key);
      if (shared && shared.signal === options.signal) return shared.promise;
      const task = new Promise<TileFetchResult>((resolve, reject) => {
        const job: QueuedTile = {
          style,
          tile,
          signal: options.signal,
          settle: resolve,
          fail: reject,
          detach: () => {},
        };
        const signal = options.signal;
        if (signal) {
          const onAbort = (): void => {
            const at = queue.indexOf(job);
            if (at < 0) return;
            queue.splice(at, 1);
            job.detach();
            reject(canceled(signal));
          };
          signal.addEventListener('abort', onAbort, { once: true });
          job.detach = () => signal.removeEventListener('abort', onAbort);
        }
        if (priority === 'now') queue.unshift(job);
        else queue.push(job);
        pump();
      });
      const entry: InFlightEntry = { promise: task, signal: options.signal };
      const clear = (): void => {
        if (inFlight.get(key) === entry) inFlight.delete(key);
      };
      void task.then(clear, clear);
      inFlight.set(key, entry);
      return task;
    },
  };
}

export interface PrefetchStats {
  downloaded: number;
  failed: number;
  total: number;
}

/** One plan's slice of the tile pre-warm, streamed through the polite queue. */
export interface WarmOptions {
  style: Style;
  tiles: TileCoord[];
  log?: (msg: string) => void;
  onTile?: (status: TileStatus) => void;
  /** Cancels the pre-warm: queued and in-flight downloads are dropped. */
  signal?: AbortSignal;
}

export interface PrefetchOptions extends WarmOptions {
  cacheDir: string;
}

export interface TileTraffic {
  /** Fetches one tile the player needs now, ahead of the pre-warm. */
  ensure(style: Style, tile: TileCoord): Promise<string>;
  /** Streams one plan's tiles; onTile fires once per settled tile. */
  stream(options: WarmOptions): Promise<PrefetchStats>;
}

// The app's tile traffic on one polite queue: on-demand tiles jump ahead of
// the background pre-warm, and both stay inside the same 2.0 req/s budget.
export function createTileTraffic(cacheDir: string): TileTraffic {
  const downloader = createDownloader(cacheDir, createPlaceholderSource());
  return {
    ensure(style, tile): Promise<string> {
      return downloader.enqueue(style, tile, { priority: 'now' }).then((result) => result.file);
    },
    stream(options): Promise<PrefetchStats> {
      const { style, tiles, log = () => {}, onTile = () => {}, signal } = options;
      const missing: TileCoord[] = [];
      for (const tile of tiles) {
        if (fs.existsSync(tilePaths(cacheDir, style, tile).file)) onTile('cached');
        else missing.push(tile);
      }
      if (missing.length === 0) {
        return Promise.resolve({ downloaded: 0, failed: 0, total: tiles.length });
      }
      log(`tiles: ${tiles.length} needed, ${missing.length} to download (${style})`);

      let downloaded = 0;
      let failed = 0;
      return Promise.all(
        missing.map((tile) =>
          downloader.enqueue(style, tile, { priority: 'background', signal }).then((result) => {
            if (result.status === 'downloaded') downloaded++;
            else if (result.status === 'failed') failed++;
            onTile(result.status);
          }),
        ),
      ).then(() => ({ downloaded, failed, total: tiles.length }));
    },
  };
}

// Polite bulk fetching for the pipeline: 2 concurrent workers, 2.0 req/s. It
// settles once per tile (cached, downloaded or failed) so callers can track
// the pre-warm's running progress, and rejects with 'tile download canceled'
// when a signal aborts it.
export function prefetchTiles(options: PrefetchOptions): Promise<PrefetchStats> {
  return createTileTraffic(options.cacheDir).stream(options);
}
