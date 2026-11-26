import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { errorMessage } from 'drone-path-core/errors';
import { runTool } from 'drone-path-core/exec-tool';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { ArchiveAvailability } from 'drone-path-desktop/shared/ipc';

export const POSTER_ID_RE = /^[a-f0-9]{16,64}$/;
const DEFAULT_MAX_CONCURRENCY = 2;

export interface PosterRegistration {
  path: string;
  mtimeMs: number | null;
  size: number | null;
  durationSec: number | null;
  availability: ArchiveAvailability;
}

export interface PosterEntry {
  videoPath: string;
  durationSec: number | null;
  availability: ArchiveAvailability;
}

export interface ArchivePostersOptions {
  cacheDir: string;
  getTools: () => Promise<FfmpegToolPaths>;
  runFfmpeg?: (ffmpegPath: string, args: readonly string[]) => Promise<void>;
  isFile?: (filePath: string) => boolean;
  maxConcurrency?: number;
  log?: (message: string) => void;
}

export interface ArchivePosters {
  register(clip: PosterRegistration): string;
  resolvePoster(posterId: string): Promise<string | null>;
}

function normalizeClipPath(clipPath: string): string {
  const resolved = path.resolve(clipPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Computes a deterministic hex cache key for a clip path and file stats. */
export function posterIdFor(
  clipPath: string,
  mtimeMs: number | null,
  size: number | null,
): string {
  const identity = `${normalizeClipPath(clipPath)}|${mtimeMs ?? ''}|${size ?? ''}`;
  return crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 32);
}

function defaultIsFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function defaultRunFfmpeg(ffmpegPath: string, args: readonly string[]): Promise<void> {
  await runTool(ffmpegPath, args);
}

/** Lazily extracts and caches mid-clip JPEG posters with bounded concurrency. */
export function createArchivePosters(options: ArchivePostersOptions): ArchivePosters {
  const cacheDir = path.resolve(options.cacheDir);
  const isFile = options.isFile ?? defaultIsFile;
  const runFfmpeg = options.runFfmpeg ?? defaultRunFfmpeg;
  const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY));
  const log = options.log ?? ((): void => {});

  const registry = new Map<string, PosterEntry>();
  const inFlight = new Map<string, Promise<string | null>>();
  const queue: Array<() => void> = [];
  let active = 0;

  function schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active += 1;
        task().then(resolve, reject).finally(() => {
          active -= 1;
          const next = queue.shift();
          if (next) next();
        });
      };
      if (active < maxConcurrency) run();
      else queue.push(run);
    });
  }

  async function extractPoster(posterId: string, entry: PosterEntry, cacheFile: string): Promise<string | null> {
    if (isFile(cacheFile)) return cacheFile;
    if (entry.availability === 'offline' || !isFile(entry.videoPath)) return null;

    fs.mkdirSync(cacheDir, { recursive: true });
    const tmpFile = path.join(cacheDir, `${posterId}.${process.pid}.${Date.now()}.tmp.jpg`);
    const seekSec =
      entry.durationSec !== null && Number.isFinite(entry.durationSec) && entry.durationSec > 0
        ? entry.durationSec / 2
        : 0;
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...(seekSec > 0 ? ['-ss', seekSec.toFixed(3)] : []),
      '-i',
      entry.videoPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=320:-2',
      '-q:v',
      '5',
      tmpFile,
    ];

    try {
      const tools = await options.getTools();
      await runFfmpeg(tools.ffmpeg, args);
      if (!isFile(tmpFile)) return null;
      fs.renameSync(tmpFile, cacheFile);
      return cacheFile;
    } catch (error) {
      log(`poster extraction failed for ${posterId}: ${errorMessage(error)}`);
      return null;
    } finally {
      try {
        fs.rmSync(tmpFile, { force: true });
      } catch {
        // Best-effort cleanup of temp poster artifact.
      }
    }
  }

  return {
    register(clip: PosterRegistration): string {
      const id = posterIdFor(clip.path, clip.mtimeMs, clip.size);
      registry.set(id, {
        videoPath: path.resolve(clip.path),
        durationSec: clip.durationSec,
        availability: clip.availability,
      });
      return id;
    },

    async resolvePoster(posterId: string): Promise<string | null> {
      if (!POSTER_ID_RE.test(posterId)) return null;
      const cacheFile = path.join(cacheDir, `${posterId}.jpg`);
      if (isFile(cacheFile)) return cacheFile;

      const entry = registry.get(posterId);
      if (!entry || entry.availability === 'offline' || !isFile(entry.videoPath)) {
        return null;
      }

      const existing = inFlight.get(posterId);
      if (existing) return existing;

      const pending = schedule(() => extractPoster(posterId, entry, cacheFile)).finally(() => {
        inFlight.delete(posterId);
      });
      inFlight.set(posterId, pending);
      return pending;
    },
  };
}
