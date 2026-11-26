import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { IndexedScanOptions } from 'drone-path-archive/indexed-scan';
import type { ArchiveFlight, NearHit } from 'drone-path-archive/query';
import type { ScanRecord } from 'drone-path-archive/scanner';
import type { ArchiveStore } from 'drone-path-archive/store';
import type { ArchiveScanProgress } from '../shared/ipc.js';
import { createArchiveService } from '../src/archiveservice.js';
import { addArchiveRoot, emptyAppState, removeArchiveRoot } from '../src/appstate.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

afterEach(cleanupTmpDirs);

const TOOLS: FfmpegToolPaths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

function makeScanRecord(filePath: string): ScanRecord {
  return {
    path: filePath,
    size: 120,
    mtimeMs: 1000,
    status: 'ok',
    video: { fps: { num: 30, den: 1, value: 30, str: '30' }, frames: 90, width: 1920, height: 1080, durationSec: 3 },
    cameraCreationTime: '2026-01-01T10:00:00Z',
    telemetry: { source: 'srt', method: 'srt-cues', fixCount: 2, noLock: 0, trackDistanceM: 42 },
    bbox: { minLat: 46.6, maxLat: 46.61, minLon: 14.2, maxLon: 14.21 },
    track: [[{ lat: 46.6, lon: 14.2, tSec: 0 }]],
    error: null,
  };
}

function makeHarness(overrides: {
  initialRoots?: string[];
  scanArchive?: (dirs: readonly string[], options: IndexedScanOptions) => Promise<ScanRecord[]>;
  listArchiveFlights?: () => ArchiveFlight[];
  nearArchive?: () => NearHit[];
  removeClipsUnder?: (root: string) => number;
  isDir?: (dir: string) => boolean;
  isFile?: (file: string) => boolean;
} = {}) {
  let state = { ...emptyAppState(), archiveRoots: overrides.initialRoots ?? [] };
  const progressEvents: ArchiveScanProgress[] = [];
  const removeClipsUnder = vi.fn(overrides.removeClipsUnder ?? (() => 0));
  const scanArchive = vi.fn(
    overrides.scanArchive ??
      (async (_dirs: readonly string[], opts: IndexedScanOptions) => {
        const rec = makeScanRecord(path.join(tmpDir(), 'DJI_0001.MP4'));
        opts.onRecord?.(rec);
        return [rec];
      }),
  );
  const listArchiveFlights = vi.fn(overrides.listArchiveFlights ?? (() => []));
  const nearArchive = vi.fn(overrides.nearArchive ?? (() => []));

  const service = createArchiveService({
    getRoots: () => state.archiveRoots,
    addRootState: (dir) => {
      state = addArchiveRoot(state, dir);
      return state.archiveRoots;
    },
    removeRootState: (dir) => {
      state = removeArchiveRoot(state, dir);
      return state.archiveRoots;
    },
    onScanProgress: (progress) => progressEvents.push(progress),
    deps: {
      dbPath: path.join(tmpDir(), 'archive.sqlite'),
      isDir: overrides.isDir ?? ((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory()),
      isFile: overrides.isFile ?? ((file) => fs.existsSync(file) && fs.statSync(file).isFile()),
      getTools: async () => TOOLS,
      scanArchive,
      listArchiveFlights,
      nearArchive,
      withArchiveStore: (_db, run) =>
        run({ removeClipsUnder } as unknown as ArchiveStore),
    },
  });

  return { service, progressEvents, removeClipsUnder, scanArchive, listArchiveFlights, nearArchive };
}

describe('createArchiveService', () => {
  it('validates watched folders and persists addRoot / removeRoot with clip pruning', () => {
    const dir = tmpDir();
    const missing = path.join(dir, 'missing');
    const filePath = path.join(dir, 'clip.mp4');
    fs.writeFileSync(filePath, 'video');

    const { service, removeClipsUnder } = makeHarness();
    expect(service.listRoots()).toEqual([]);

    expect(() => service.addRoot('')).toThrow(expect.objectContaining({ code: 'ARCHIVE_ROOT_INVALID' }));
    expect(() => service.addRoot(missing)).toThrow(expect.objectContaining({ code: 'ARCHIVE_ROOT_INVALID' }));
    expect(() => service.addRoot(filePath)).toThrow(expect.objectContaining({ code: 'ARCHIVE_ROOT_INVALID' }));

    expect(service.addRoot(dir)).toEqual([path.resolve(dir)]);
    expect(service.addRoot(dir)).toEqual([path.resolve(dir)]);
    expect(service.listRoots()).toEqual([path.resolve(dir)]);

    expect(service.removeRoot(dir)).toEqual([]);
    expect(removeClipsUnder).toHaveBeenCalledWith(path.resolve(dir));
  });

  it('emits scan progress events and completes cleanly', async () => {
    const dir = tmpDir();
    const clip = path.join(dir, 'sub', 'DJI_0001.MP4');
    const { service, progressEvents, scanArchive } = makeHarness({
      initialRoots: [dir],
      scanArchive: async (_dirs, opts) => {
        expect(opts.recurse).toBe(true);
        const r = makeScanRecord(clip);
        opts.onRecord?.(r);
        return [r];
      },
    });

    const result = await service.scan();
    expect(result).toEqual({ scanned: 1 });
    expect(scanArchive).toHaveBeenCalledWith([dir], expect.objectContaining({ recurse: true }));
    expect(progressEvents).toEqual([
      { phase: 'scanning', scanned: 0, status: 'running' },
      { phase: 'scanning', scanned: 1, currentPath: clip, status: 'running' },
      { phase: 'done', scanned: 1, total: 1, status: 'done' },
    ]);
  });

  it('rejects concurrent scans with ARCHIVE_SCAN_RUNNING', async () => {
    const dir = tmpDir();
    let release!: () => void;
    const { service } = makeHarness({
      initialRoots: [dir],
      scanArchive: () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    });

    const first = service.scan();
    await expect(service.scan()).rejects.toMatchObject({ code: 'ARCHIVE_SCAN_RUNNING' });
    release();
    await expect(first).resolves.toEqual({ scanned: 0 });
  });

  it('aborts an active scan via cancelScan and emits canceled progress', async () => {
    const dir = tmpDir();
    const { service, progressEvents } = makeHarness({
      initialRoots: [dir],
      scanArchive: (_dirs, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    });

    const pending = service.scan();
    service.cancelScan();
    await expect(pending).rejects.toMatchObject({ code: 'ARCHIVE_SCAN_CANCELED' });
    expect(progressEvents.at(-1)).toEqual({ phase: 'canceled', scanned: 0, status: 'canceled' });
  });

  it('returns query counts including offline clips and delegates findAtPoint with includeGaze defaulting to true', () => {
    const dir = tmpDir();
    const onlineClip = { ...makeScanRecord(path.join(dir, 'a.mp4')), availability: 'online' as const, splitFromKey: null };
    const offlineClip = { ...makeScanRecord(path.join(dir, 'b.mp4')), availability: 'offline' as const, splitFromKey: null };
    const flights: ArchiveFlight[] = [
      { flightId: 'f1', clips: [onlineClip, offlineClip] },
    ];
    const hit: NearHit = {
      clip: { ...makeScanRecord(path.join(dir, 'a.mp4')), availability: 'online' },
      tSec: 12.5,
      distanceM: 0,
      matchType: 'gaze',
    };

    const { service, listArchiveFlights, nearArchive } = makeHarness({
      listArchiveFlights: () => flights,
      nearArchive: () => [hit],
    });

    expect(service.query({ minDistanceM: 10 })).toEqual({
      flights,
      totalCount: 2,
      offlineCount: 1,
    });
    expect(listArchiveFlights).toHaveBeenCalledWith(expect.any(String), { minDistanceM: 10 });

    expect(service.findAtPoint({ lat: 46.6, lon: 14.2 }, 150)).toEqual([hit]);
    expect(nearArchive).toHaveBeenCalledWith(expect.any(String), { lat: 46.6, lon: 14.2 }, 150, true);

    expect(() => service.query({ minSmoothness: 2 })).toThrow();
    expect(() => service.findAtPoint({ lat: 95, lon: 14.2 })).toThrow();
  });

  it('propagates scan errors for missing unindexed roots and emits error progress', async () => {
    const missing = path.join(tmpDir(), 'missing-folder');
    const { service, progressEvents } = makeHarness({
      scanArchive: async () => {
        throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${missing}'`), {
          code: 'ENOENT',
          path: missing,
        });
      },
    });

    await expect(service.scan([missing])).rejects.toThrow(/ENOENT/);
    expect(progressEvents.at(-1)).toEqual({ phase: 'error', scanned: 0, status: 'error' });
  });
});
