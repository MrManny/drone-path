import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import { createArchivePosters, posterIdFor } from '../src/archiveposters.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

afterEach(cleanupTmpDirs);

const TOOLS: FfmpegToolPaths = { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe' };

describe('posterIdFor', () => {
  it('produces a deterministic 32-char lowercase hex hash and distinguishes stats', () => {
    const dir = tmpDir();
    const unnormalized = `${dir}${path.sep}sub${path.sep}..${path.sep}DJI_0001.MP4`;
    const canonical = path.join(dir, 'DJI_0001.MP4');
    const id1 = posterIdFor(unnormalized, 1000, 2048);
    const id2 = posterIdFor(canonical, 1000, 2048);
    expect(id1).toMatch(/^[a-f0-9]{32}$/);
    expect(id1).toBe(id2);
    expect(posterIdFor(canonical, 1001, 2048)).not.toBe(id1);
    expect(posterIdFor(canonical, 1000, 4096)).not.toBe(id1);
  });
});

describe('createArchivePosters', () => {
  it('lazily extracts a mid-clip JPEG once and reuses the disk cache across instances', async () => {
    const root = tmpDir();
    const cacheDir = path.join(root, 'posters');
    const videoPath = path.join(root, 'DJI_0001.MP4');
    fs.writeFileSync(videoPath, 'video-bytes');

    const runFfmpeg = vi.fn(async (_cmd: string, args: readonly string[]) => {
      const outPath = args.at(-1)!;
      fs.writeFileSync(outPath, 'jpeg-bytes');
    });

    const posters = createArchivePosters({
      cacheDir,
      getTools: async () => TOOLS,
      runFfmpeg,
    });
    const id = posters.register({
      path: videoPath,
      mtimeMs: 1234,
      size: 5678,
      durationSec: 12,
      availability: 'online',
    });

    const resolved = await posters.resolvePoster(id);
    expect(resolved).toBe(path.join(cacheDir, `${id}.jpg`));
    expect(fs.readFileSync(resolved!, 'utf8')).toBe('jpeg-bytes');
    expect(runFfmpeg).toHaveBeenCalledTimes(1);
    expect(runFfmpeg).toHaveBeenCalledWith(
      TOOLS.ffmpeg,
      expect.arrayContaining([
        '-ss',
        '6.000',
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-2',
        '-q:v',
        '5',
      ]),
    );

    // A fresh instance (across launches) serves the cached JPEG without calling ffmpeg.
    const nextLaunchFfmpeg = vi.fn();
    const nextPosters = createArchivePosters({
      cacheDir,
      getTools: async () => TOOLS,
      runFfmpeg: nextLaunchFfmpeg,
    });
    await expect(nextPosters.resolvePoster(id)).resolves.toBe(path.join(cacheDir, `${id}.jpg`));
    expect(nextLaunchFfmpeg).not.toHaveBeenCalled();
  });

  it('serves cached JPEGs for offline clips and returns null without invoking ffmpeg when uncached', async () => {
    const root = tmpDir();
    const cacheDir = path.join(root, 'posters');
    const offlineVideo = path.join(root, 'offline.MP4');
    const missingOnline = path.join(root, 'missing.MP4');
    const runFfmpeg = vi.fn();
    const posters = createArchivePosters({
      cacheDir,
      getTools: async () => TOOLS,
      runFfmpeg,
    });

    const uncachedOfflineId = posters.register({
      path: offlineVideo,
      mtimeMs: 1,
      size: 2,
      durationSec: 10,
      availability: 'offline',
    });
    await expect(posters.resolvePoster(uncachedOfflineId)).resolves.toBeNull();

    const missingId = posters.register({
      path: missingOnline,
      mtimeMs: 3,
      size: 4,
      durationSec: 10,
      availability: 'online',
    });
    await expect(posters.resolvePoster(missingId)).resolves.toBeNull();
    expect(runFfmpeg).not.toHaveBeenCalled();

    fs.mkdirSync(cacheDir, { recursive: true });
    const cachedOfflinePath = path.join(cacheDir, `${uncachedOfflineId}.jpg`);
    fs.writeFileSync(cachedOfflinePath, 'cached-jpeg');
    await expect(posters.resolvePoster(uncachedOfflineId)).resolves.toBe(cachedOfflinePath);
    expect(runFfmpeg).not.toHaveBeenCalled();

    await expect(posters.resolvePoster('not-a-valid-id')).resolves.toBeNull();
    await expect(posters.resolvePoster('a'.repeat(32))).resolves.toBeNull();
  });

  it('deduplicates concurrent requests and caps ffmpeg concurrency to 2', async () => {
    const root = tmpDir();
    const cacheDir = path.join(root, 'posters');
    const clips = [0, 1, 2, 3, 4].map((index) => {
      const file = path.join(root, `clip_${index}.MP4`);
      fs.writeFileSync(file, `bytes-${index}`);
      return file;
    });

    let active = 0;
    let maxObserved = 0;
    const pendingResolvers: Array<() => void> = [];
    const runFfmpeg = vi.fn(
      (_cmd: string, args: readonly string[]) =>
        new Promise<void>((resolve) => {
          active += 1;
          maxObserved = Math.max(maxObserved, active);
          const outPath = args.at(-1)!;
          pendingResolvers.push(() => {
            fs.writeFileSync(outPath, 'ok');
            active -= 1;
            resolve();
          });
        }),
    );

    const posters = createArchivePosters({
      cacheDir,
      getTools: async () => TOOLS,
      runFfmpeg,
      maxConcurrency: 2,
    });
    const ids = clips.map((clip, i) =>
      posters.register({
        path: clip,
        mtimeMs: i,
        size: 100,
        durationSec: 0,
        availability: 'online',
      }),
    );

    // Request id[0] twice concurrently plus 4 more distinct ids.
    const promises = [
      posters.resolvePoster(ids[0]),
      posters.resolvePoster(ids[0]),
      ...ids.slice(1).map((id) => posters.resolvePoster(id)),
    ];

    // Wait a tick for the queue to dispatch the first 2 tasks.
    await new Promise((r) => setTimeout(r, 10));
    expect(maxObserved).toBe(2);
    expect(runFfmpeg).toHaveBeenCalledTimes(2);

    while (pendingResolvers.length > 0 || active > 0) {
      const next = pendingResolvers.shift();
      if (next) next();
      await new Promise((r) => setTimeout(r, 5));
    }

    const results = await Promise.all(promises);
    expect(results[0]).toBe(results[1]);
    expect(results.every((entry) => entry !== null)).toBe(true);
    expect(runFfmpeg).toHaveBeenCalledTimes(5);
    expect(maxObserved).toBe(2);
  });

  it('cleans up temporary files and returns null when ffmpeg fails', async () => {
    const root = tmpDir();
    const cacheDir = path.join(root, 'posters');
    const videoPath = path.join(root, 'corrupt.MP4');
    fs.writeFileSync(videoPath, 'bad');
    const log = vi.fn();

    const posters = createArchivePosters({
      cacheDir,
      getTools: async () => TOOLS,
      runFfmpeg: async (_cmd, args) => {
        fs.writeFileSync(args.at(-1)!, 'partial');
        throw new Error('ffmpeg exited with code 1');
      },
      log,
    });
    const id = posters.register({
      path: videoPath,
      mtimeMs: 1,
      size: 3,
      durationSec: null,
      availability: 'online',
    });

    await expect(posters.resolvePoster(id)).resolves.toBeNull();
    expect(fs.readdirSync(cacheDir)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('poster extraction failed'));
  });
});
