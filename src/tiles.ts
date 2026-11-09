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

const USER_AGENT = `drone-path/${VERSION} (flight-path map renderer; https://github.com/MrManny/drone-path)`;

const DOWNLOAD_ATTEMPTS = 2;
const DOWNLOAD_WORKERS = 2;
const REQUEST_INTERVAL_MS = 500;
const RETRY_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 20000;

type RequestGate = () => Promise<void>;

function createRequestGate(): RequestGate {
  let nextFreeAt = 0;
  let tail: Promise<void> = Promise.resolve();
  return () => {
    const turn = tail.then(async () => {
      for (;;) {
        const now = Date.now();
        if (now >= nextFreeAt) {
          nextFreeAt = now + REQUEST_INTERVAL_MS;
          return;
        }
        await sleep(nextFreeAt - now);
      }
    });
    tail = turn.catch(() => {});
    return turn;
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

function canceledError(signal: AbortSignal): Error {
  return new Error('tile download canceled', { cause: signal.reason });
}

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
      if (signal?.aborted) throw canceledError(signal);
      await sleep(RETRY_DELAY_MS);
    }
  }
  return null;
}

function writeCacheFile(cachePath: string, data: Buffer): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, data);
  } catch (e) {
    throw new Error(`cache write failed: ${cachePath}: ${errorMessage(e)}`, { cause: e });
  }
}

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

type TileStatus = 'cached' | 'downloaded' | 'failed';

interface TileFetchResult {
  file: string;
  status: TileStatus;
}

interface FetchContext {
  cacheDir: string;
  acquire: RequestGate;
  placeholderPng: (style: Style) => Buffer;
}

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

type TilePriority = 'now' | 'background';

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
        job.fail(canceledError(job.signal));
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
      // Share only within one stream: a canceled stream's downloads must never be handed to the next one.
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
            reject(canceledError(signal));
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

export interface WarmOptions {
  style: Style;
  tiles: TileCoord[];
  log?: (msg: string) => void;
  onTile?: (status: TileStatus) => void;
  signal?: AbortSignal;
}

export interface PrefetchOptions extends WarmOptions {
  cacheDir: string;
}

export interface TileTraffic {
  ensure(style: Style, tile: TileCoord): Promise<string>;
  stream(options: WarmOptions): Promise<PrefetchStats>;
}

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

export function prefetchTiles(options: PrefetchOptions): Promise<PrefetchStats> {
  return createTileTraffic(options.cacheDir).stream(options);
}
