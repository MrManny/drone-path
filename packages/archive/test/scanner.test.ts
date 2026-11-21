import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeVideo } from 'drone-path-core/ffmpeg';

import { cleanupTmpDirs, probeFixture, productMetaPacket, SRT_SAMPLE, tmpDir } from '../../../test/fixtures/core.js';
import { camMetaMp4 } from '../../../test/fixtures/mp4-cammeta.js';
import { scanFolders } from '../src/scanner.js';

vi.mock('drone-path-core/ffmpeg', { spy: true });

const tools = { ffmpeg: 'ffmpeg-unused', ffprobe: 'ffprobe-unused' };
const probe = vi.mocked(probeVideo);
const creationTime = '2026-05-25T09:18:11';
const noGps = '00:00:00,000 --> 00:00:00,033\n[latitude: 0.0] [longitude: 0.0]\n';

beforeEach(() => {
  probe.mockReset().mockResolvedValue(probeFixture({ camMeta: null, creationTime }));
});
afterEach(cleanupTmpDirs);

describe('scanFolders', () => {
  it('recursively classifies mixed media and keeps GPS gaps and camera metadata', async () => {
    const dir = tmpDir();
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    for (const file of ['c-corrupt.mp4', 'b-indoor.MP4', 'a-flight.mp4', 'output_MAP.mp4', 'proxy.LRF']) {
      fs.writeFileSync(path.join(dir, file), 'video');
    }
    fs.writeFileSync(path.join(sub, 'd-other.mp4'), 'video');
    fs.writeFileSync(path.join(dir, 'a-flight.sRt'), SRT_SAMPLE);
    fs.writeFileSync(path.join(dir, 'b-indoor.SRT'), noGps);
    probe.mockImplementation(async (_tools, file) => {
      if (file.endsWith('corrupt.mp4')) throw new Error('unreadable video');
      return probeFixture({ camMeta: null, creationTime });
    });

    const records = await scanFolders([dir, sub, dir], { tools, recurse: true });
    expect(records.map(({ path: file, status }) => [path.basename(file), status])).toEqual([
      ['a-flight.mp4', 'ok'],
      ['b-indoor.MP4', 'no-gps'],
      ['c-corrupt.mp4', 'error'],
      ['d-other.mp4', 'no-telemetry'],
    ]);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(records[0]).toMatchObject({
      cameraCreationTime: creationTime,
      size: 5,
      mtimeMs: fs.statSync(path.join(dir, 'a-flight.mp4')).mtimeMs,
      telemetry: { source: 'srt', fixCount: 2, noLock: 1, trackDistanceM: 0 },
      bbox: { minLat: 46.61307, maxLat: 46.613071, minLon: 14.262388, maxLon: 14.262389 },
      track: [[{ lat: 46.61307, lon: 14.262388, tSec: 0 }], [{ lat: 46.613071, lon: 14.262389, tSec: 0.066 }]],
    });
    expect(records[1]).toMatchObject({ bbox: null, track: [], telemetry: { noLock: 1 } });
    expect(records[2]).toMatchObject({ size: 5, error: 'unreadable video' });
    expect(records[3]).toMatchObject({ telemetry: null, video: { frames: 3 } });
    await expect(scanFolders([dir], { tools })).resolves.toHaveLength(3);
  });

  it('reports a no-lock DVTM clip without consulting its SRT sidecar', async () => {
    const dir = tmpDir();
    const noLockPacket = productMetaPacket(0, 0);
    fs.writeFileSync(path.join(dir, 'indoor.mp4'), camMetaMp4('ordinary', [
      noLockPacket, noLockPacket, noLockPacket,
    ]).file);
    fs.writeFileSync(path.join(dir, 'indoor.srt'), SRT_SAMPLE);
    probe.mockResolvedValue(probeFixture({ camMeta: { index: 1, trackId: 3 } }));

    const [record] = await scanFolders([dir], { tools });
    expect(record).toMatchObject({
      status: 'no-gps', bbox: null, track: [], telemetry: { source: 'cammeta', fixCount: 0, noLock: 3 },
    });
  });

  it('returns records in path order even when a later clip finishes first', async () => {
    const dir = tmpDir();
    for (const file of ['b.mp4', 'a.mp4']) fs.writeFileSync(path.join(dir, file), '');
    const first = Promise.withResolvers<ReturnType<typeof probeFixture>>();
    const seen: string[] = [];
    probe.mockImplementation(async (_tools, file) => file.endsWith('a.mp4')
      ? first.promise
      : probeFixture({ camMeta: null }));
    const records = await scanFolders([dir], {
      tools,
      concurrency: 2,
      onRecord: ({ path: file }) => {
        seen.push(path.basename(file));
        first.resolve(probeFixture({ camMeta: null }));
      },
    });
    expect(seen).toEqual(['b.mp4', 'a.mp4']);
    expect(records.map((record) => path.basename(record.path))).toEqual(['a.mp4', 'b.mp4']);
  });

  it('cancels active work and leaves queued recordings unprobed', async () => {
    const dir = tmpDir();
    for (const file of ['b.mp4', 'a.mp4']) fs.writeFileSync(path.join(dir, file), '');
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const canceled = new Error('scan canceled');
    probe.mockImplementation(async (_tools, _file, _log, signal) => {
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
        started.resolve();
      });
      await cleanup.promise;
      signal?.throwIfAborted();
      return probeFixture({ camMeta: null });
    });

    const onRecord = vi.fn();
    let settled = false;
    const scan = scanFolders([dir], { tools, concurrency: 1, signal: controller.signal, onRecord });
    const verified = expect(scan.finally(() => { settled = true; })).rejects.toBe(canceled);
    await started.promise;
    controller.abort(canceled);
    await Promise.resolve();
    expect(settled).toBe(false);
    cleanup.resolve();
    await verified;
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onRecord).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir)).toEqual(['a.mp4', 'b.mp4']);
  });
});
