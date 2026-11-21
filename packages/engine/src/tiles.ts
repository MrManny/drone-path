import fs from 'node:fs';
import path from 'node:path';

import PQueue from 'p-queue';

import type { MapStyle } from './config.js';
import { errorMessage } from 'drone-path-core/errors';
import type { TileCoord } from './plan.js';
import { solidPng } from './png.js';
import { tilePaths } from './tilecache.js';
import { TILE_SOURCES } from './renderer/tilesources.js';
import { VERSION } from './version.js';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(canceledError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(canceledError(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const DOWNLOAD_ATTEMPTS = 2;
const DOWNLOAD_WORKERS = 2;
const REQUEST_INTERVAL_MS = 500;
const RETRY_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 20000;

type TilePriority = 'now' | 'background';

// p-queue starts higher priorities first, so 'now' jumps the queued pre-warm.
const TASK_PRIORITY: Record<TilePriority, number> = { now: 1, background: 0 };

function tileUrl(style: MapStyle, tile: TileCoord): string {
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

function canceledError(signal: AbortSignal): Error {
  return new Error('tile download canceled', { cause: signal.reason });
}

async function fetchBody(url: string, userAgent: string, signal?: AbortSignal): Promise<Buffer | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    signal: signal
      ? AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), signal])
      : AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

async function downloadTile(
  ctx: FetchContext,
  url: string,
  priority: TilePriority,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw canceledError(signal);
    try {
      const body = await ctx.queue.add(() => fetchBody(url, ctx.userAgent, signal), {
        priority: TASK_PRIORITY[priority],
        signal,
      });
      if (body) return body;
    } catch {
      if (signal?.aborted) throw canceledError(signal);
    }
    if (attempt + 1 < DOWNLOAD_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS, signal);
    }
  }
  return null;
}

let cacheWriteSeq = 0;

function writeCacheFile(cachePath: string, data: Buffer): void {
  const dir = path.dirname(cachePath);
  const tmpPath = path.join(dir, `${path.basename(cachePath)}.${process.pid}.${++cacheWriteSeq}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, cachePath);
  } catch (e) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup so the original cache write error propagates
    }
    throw new Error(`cache write failed: ${cachePath}: ${errorMessage(e)}`, { cause: e });
  }
}

function createPlaceholderSource(): (style: MapStyle) => Buffer {
  const cache = new Map<MapStyle, Buffer>();
  return (style) => {
    let png = cache.get(style);
    if (!png) {
      png = solidPng(TILE_SOURCES[style].placeholderBg);
      cache.set(style, png);
    }
    return png;
  };
}

type TileStatus = 'cached' | 'downloaded' | 'failed';

interface TileFetchResult {
  file: string;
  status: TileStatus;
}

interface FetchContext {
  cacheDir: string;
  queue: PQueue;
  userAgent: string;
  placeholderPng: (style: MapStyle) => Buffer;
}

async function fetchTileToCache(
  ctx: FetchContext,
  style: MapStyle,
  tile: TileCoord,
  priority: TilePriority,
  signal?: AbortSignal,
): Promise<TileFetchResult> {
  if (signal?.aborted) throw canceledError(signal);
  const paths = tilePaths(ctx.cacheDir, style, tile);
  if (fs.existsSync(paths.file)) return { file: paths.file, status: 'cached' };
  const body = await downloadTile(ctx, tileUrl(style, tile), priority, signal);
  if (body) {
    writeCacheFile(paths.file, body);
    return { file: paths.file, status: 'downloaded' };
  }
  if (signal?.aborted) throw canceledError(signal);
  writeCacheFile(paths.placeholder, ctx.placeholderPng(style));
  return { file: paths.placeholder, status: 'failed' };
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(canceledError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(canceledError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

interface Downloader {
  enqueue(
    style: MapStyle,
    tile: TileCoord,
    options?: { priority?: TilePriority; signal?: AbortSignal },
  ): Promise<TileFetchResult>;
}

interface InFlightEntry {
  promise: Promise<TileFetchResult>;
  signal?: AbortSignal;
}

function createDownloader(
  cacheDir: string,
  userAgent: string,
  placeholderPng: (style: MapStyle) => Buffer,
): Downloader {
  const queue = new PQueue({
    concurrency: DOWNLOAD_WORKERS,
    intervalCap: 1,
    interval: REQUEST_INTERVAL_MS,
    // Sliding window: no more than intervalCap starts in any interval window,
    // matching the old request gate's nextFreeAt semantics.
    strict: true,
  });
  const ctx: FetchContext = { cacheDir, queue, userAgent, placeholderPng };
  const inFlight = new Map<string, InFlightEntry>();

  const enqueue: Downloader['enqueue'] = (style, tile, options = {}) => {
    if (options.signal?.aborted) {
      return Promise.reject(canceledError(options.signal));
    }
    const priority = options.priority ?? 'background';
    const key = tilePaths(cacheDir, style, tile).file;
    const shared = inFlight.get(key);
    if (shared && !shared.signal?.aborted) {
      return withAbort(shared.promise, options.signal).catch((e) => {
        if (shared.signal?.aborted && !options.signal?.aborted) {
          return enqueue(style, tile, options);
        }
        throw e;
      });
    }
    const task = fetchTileToCache(ctx, style, tile, priority, options.signal);
    const entry: InFlightEntry = { promise: task, signal: options.signal };
    const clear = (): void => {
      options.signal?.removeEventListener('abort', clear);
      if (inFlight.get(key) === entry) inFlight.delete(key);
    };
    options.signal?.addEventListener('abort', clear, { once: true });
    void task.then(clear, clear);
    inFlight.set(key, entry);
    return task;
  };

  return { enqueue };
}

export interface PrefetchStats {
  downloaded: number;
  failed: number;
  total: number;
}

export interface WarmOptions {
  style: MapStyle;
  tiles: TileCoord[];
  log?: (msg: string) => void;
  onTile?: (status: TileStatus) => void;
  signal?: AbortSignal;
}

interface PrefetchOptions extends WarmOptions {
  cacheDir: string;
}

interface TileTraffic {
  ensure(style: MapStyle, tile: TileCoord): Promise<string>;
  stream(options: WarmOptions): Promise<PrefetchStats>;
}

export function createTileTraffic(cacheDir: string, version = VERSION): TileTraffic {
  const userAgent = `drone-path/${version} (flight-path map renderer; https://github.com/MrManny/drone-path)`;
  const downloader = createDownloader(cacheDir, userAgent, createPlaceholderSource());
  return {
    ensure(style, tile): Promise<string> {
      return downloader.enqueue(style, tile, { priority: 'now' }).then((result) => result.file);
    },
    stream(options): Promise<PrefetchStats> {
      const { style, tiles, log = () => {}, onTile = () => {}, signal } = options;
      if (signal?.aborted) return Promise.reject(canceledError(signal));
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

export function prefetchTiles(options: PrefetchOptions): Promise<PrefetchStats> {
  return createTileTraffic(options.cacheDir).stream(options);
}
