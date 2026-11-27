import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeVideo } from 'drone-path-core/ffmpeg';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { IndexedScanOptions } from 'drone-path-archive/indexed-scan';
import type { ArchiveFlight, NearHit } from 'drone-path-archive/query';
import type { ScanRecord } from 'drone-path-archive/scanner';
import type { ArchiveStore } from 'drone-path-archive/store';
import type { ArchiveScanProgress } from '../shared/ipc.js';
import { createArchiveService } from '../src/archiveservice.js';
import { posterIdFor } from '../src/archiveposters.js';
import type { PosterRegistration } from '../src/archiveposters.js';
import { addArchiveRoot, emptyAppState, removeArchiveRoot } from '../src/appstate.js';
import { cleanupTmpDirs, probeFixture, SRT_SAMPLE, tmpDir } from '../../../test/fixtures/core.js';

vi.mock('drone-path-core/ffmpeg', { spy: true });

const mockedProbe = vi.mocked(probeVideo);

beforeEach(() => {
  mockedProbe.mockReset().mockResolvedValue(probeFixture({ camMeta: null }));
});

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
  listArchiveFlightOverviews?: () => ArchiveFlight[];
  nearArchive?: () => NearHit[];
  exportArchiveTracks?: () => void;
  exportArchiveMap?: () => void;
  registerPoster?: (clip: PosterRegistration) => string;
  removeClipsUnder?: (root: string) => number;
  pruneOffline?: () => number;
  snapshotClips?: ReturnType<ArchiveStore['snapshot']>['clips'];
  isDir?: (dir: string) => boolean;
  isFile?: (file: string) => boolean;
} = {}) {
  let state = { ...emptyAppState(), archiveRoots: overrides.initialRoots ?? [] };
  const progressEvents: ArchiveScanProgress[] = [];
  const removeClipsUnder = vi.fn(overrides.removeClipsUnder ?? (() => 0));
  const pruneOffline = vi.fn(overrides.pruneOffline ?? (() => 0));
  const snapshot = vi.fn(() => ({ revision: 0, clips: overrides.snapshotClips ?? [] }));
  const scanArchive = vi.fn(
    overrides.scanArchive ??
      (async (_dirs: readonly string[], opts: IndexedScanOptions) => {
        const rec = makeScanRecord(path.join(tmpDir(), 'DJI_0001.MP4'));
        opts.onRecord?.(rec);
        return [rec];
      }),
  );
  const listArchiveFlights = vi.fn(overrides.listArchiveFlights ?? (() => []));
  const listArchiveFlightOverviews = overrides.listArchiveFlightOverviews
    ? vi.fn(overrides.listArchiveFlightOverviews)
    : undefined;
  const nearArchive = vi.fn(overrides.nearArchive ?? (() => []));
  const exportArchiveTracks = vi.fn(overrides.exportArchiveTracks ?? (() => {}));
  const exportArchiveMap = vi.fn(overrides.exportArchiveMap ?? (() => {}));
  const registerPoster = overrides.registerPoster ? vi.fn(overrides.registerPoster) : undefined;

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
      ...(listArchiveFlightOverviews ? { listArchiveFlightOverviews } : {}),
      nearArchive,
      exportArchiveTracks,
      exportArchiveMap,
      ...(registerPoster ? { registerPoster } : {}),
      withArchiveStore: (_db, run) =>
        run({ removeClipsUnder, pruneOffline, snapshot } as unknown as ArchiveStore),
    },
  });

  return {
    service,
    progressEvents,
    removeClipsUnder,
    pruneOffline,
    scanArchive,
    listArchiveFlights,
    listArchiveFlightOverviews,
    nearArchive,
    exportArchiveTracks,
    exportArchiveMap,
    registerPoster,
  };
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
      flights: [
        {
          flightId: 'f1',
          clips: [
            { ...onlineClip, posterId: posterIdFor(onlineClip.path, onlineClip.mtimeMs, onlineClip.size) },
            { ...offlineClip, posterId: posterIdFor(offlineClip.path, offlineClip.mtimeMs, offlineClip.size) },
          ],
        },
      ],
      totalCount: 2,
      offlineCount: 1,
    });
    expect(listArchiveFlights).toHaveBeenCalledWith(expect.any(String), { minDistanceM: 10 });

    expect(service.findAtPoint({ lat: 46.6, lon: 14.2 }, 150)).toEqual([hit]);
    expect(nearArchive).toHaveBeenCalledWith(expect.any(String), { lat: 46.6, lon: 14.2 }, 150, true);

    expect(() => service.query({ minSmoothness: 2 })).toThrow();
    expect(() => service.findAtPoint({ lat: 95, lon: 14.2 })).toThrow();
  });

  it('propagates scan errors on reachable roots and emits error progress', async () => {
    const dir = tmpDir();
    const { service, progressEvents } = makeHarness({
      scanArchive: async () => {
        throw Object.assign(new Error(`EIO: i/o error, scandir '${dir}'`), {
          code: 'EIO',
          path: dir,
        });
      },
    });

    await expect(service.scan([dir])).rejects.toThrow(/EIO/);
    expect(progressEvents.at(-1)).toEqual({ phase: 'error', scanned: 0, status: 'error' });
  });

  it('uses listArchiveFlightOverviews for viewport queries when provided', () => {
    const flights: ArchiveFlight[] = [
      { flightId: 'f1', clips: [{ ...makeScanRecord('a.mp4'), availability: 'online', splitFromKey: null }] },
    ];
    const { service, listArchiveFlightOverviews, listArchiveFlights } = makeHarness({
      listArchiveFlightOverviews: () => flights,
    });
    const bbox = { minLat: 46, maxLat: 47, minLon: 14, maxLon: 15 };
    expect(service.query({ bbox })).toEqual({
      flights: [
        {
          flightId: 'f1',
          clips: [
            {
              ...flights[0].clips[0],
              posterId: posterIdFor('a.mp4', flights[0].clips[0].mtimeMs, flights[0].clips[0].size),
            },
          ],
        },
      ],
      totalCount: 1,
      offlineCount: 0,
    });
    expect(listArchiveFlightOverviews).toHaveBeenCalledWith(expect.any(String), { bbox });
    expect(listArchiveFlights).not.toHaveBeenCalled();
  });

  it('uses listArchiveFlights for detail: full viewport queries', () => {
    const flights: ArchiveFlight[] = [
      { flightId: 'f1', clips: [{ ...makeScanRecord('a.mp4'), availability: 'online', splitFromKey: null }] },
    ];
    const { service, listArchiveFlightOverviews, listArchiveFlights } = makeHarness({
      listArchiveFlightOverviews: () => [],
      listArchiveFlights: () => flights,
    });
    const bbox = { minLat: 46, maxLat: 47, minLon: 14, maxLon: 15 };
    const result = service.query({ bbox, detail: 'full' });
    expect(result.flights).toHaveLength(1);
    expect(listArchiveFlights).toHaveBeenCalledWith(expect.any(String), { bbox });
    expect(listArchiveFlightOverviews).not.toHaveBeenCalled();
  });

  it('filters query results by folderRoot and flightId and registers poster entries', () => {
    const rootA = path.join(tmpDir(), 'rootA');
    const rootB = path.join(tmpDir(), 'rootB');
    const clipA = { ...makeScanRecord(path.join(rootA, 'DJI_0001.MP4')), availability: 'online' as const, splitFromKey: null };
    const clipB = { ...makeScanRecord(path.join(rootB, 'DJI_0002.MP4')), availability: 'offline' as const, splitFromKey: null };
    const registerPoster = vi.fn((clip: PosterRegistration) => posterIdFor(clip.path, clip.mtimeMs, clip.size));
    const { service, listArchiveFlights } = makeHarness({
      listArchiveFlights: () => [
        { flightId: 'flight-a', clips: [clipA] },
        { flightId: 'flight-b', clips: [clipB] },
      ],
      registerPoster,
    });

    const byFolder = service.query({ folderRoot: rootA });
    expect(listArchiveFlights).toHaveBeenLastCalledWith(expect.any(String), {});
    expect(byFolder.totalCount).toBe(1);
    expect(byFolder.offlineCount).toBe(0);
    expect(byFolder.flights.map((f) => f.flightId)).toEqual(['flight-a']);
    expect(registerPoster).toHaveBeenCalledWith(
      expect.objectContaining({ path: clipA.path, availability: 'online', durationSec: 3 }),
    );

    const byFlight = service.query({ flightId: 'flight-b' });
    expect(byFlight.totalCount).toBe(1);
    expect(byFlight.offlineCount).toBe(1);
    expect(byFlight.flights[0].clips[0].path).toBe(clipB.path);
  });

  it('exports archive tracks and HTML maps and wraps export failures as ARCHIVE_EXPORT_FAILED', () => {
    const outGpx = path.join(tmpDir(), 'out', 'archive.gpx');
    const outHtml = path.join(tmpDir(), 'out', 'archive.html');
    const { service, exportArchiveTracks, exportArchiveMap } = makeHarness();

    service.exportArchive({
      outPath: outGpx,
      format: 'gpx',
      filters: { minDistanceM: 25, folderRoot: tmpDir(), flightId: 'flight-1' },
      redactLaunchM: 200,
    });
    expect(exportArchiveTracks).toHaveBeenCalledWith(expect.any(String), outGpx, {
      filters: { minDistanceM: 25 },
      redactLaunchM: 200,
    });

    service.exportArchive({
      outPath: outHtml,
      format: 'html',
      includeGaze: true,
      offline: true,
    });
    expect(exportArchiveMap).toHaveBeenCalledWith(expect.any(String), outHtml, {
      includeGaze: true,
      offline: true,
    });

    expect(() => service.exportArchive({ outPath: 'relative.gpx', format: 'gpx' })).toThrow(
      expect.objectContaining({ code: 'OUTPUT_PATH_ABSOLUTE' }),
    );
    expect(() => service.exportArchive({ outPath: outGpx, format: 'html' })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );

    exportArchiveTracks.mockImplementationOnce(() => {
      throw new Error('sqlite read failed');
    });
    expect(() => service.exportArchive({ outPath: outGpx, format: 'gpx' })).toThrow(
      expect.objectContaining({ code: 'ARCHIVE_EXPORT_FAILED' }),
    );
  });

  it('handles unreachable empty roots gracefully without failing scan', async () => {
    const missing = path.join(tmpDir(), 'unplugged-empty');
    const { service, progressEvents, scanArchive } = makeHarness({
      initialRoots: [missing],
    });

    await expect(service.scan()).resolves.toEqual({ scanned: 0 });
    expect(scanArchive).not.toHaveBeenCalled();
    expect(progressEvents.at(-1)).toEqual({ phase: 'done', scanned: 0, total: 0, status: 'done' });
    expect(service.query().offlineRoots).toEqual([missing]);
  });

  it('prunes deleted files on online roots, preserves unplugged drives offline, restores on reconnect without reprobing, and prunes offline on demand', async () => {
    const base = fs.realpathSync(tmpDir());
    const dbPath = path.join(base, 'archive.sqlite');
    const onlineRoot = path.join(base, 'local-drive');
    const driveRoot = path.join(base, 'external-drive');
    const displacedDrive = path.join(base, 'external-drive-unplugged');
    fs.mkdirSync(onlineRoot);
    fs.mkdirSync(driveRoot);

    const localKept = path.join(onlineRoot, 'DJI_0001.MP4');
    const localDeleted = path.join(onlineRoot, 'DJI_0002.MP4');
    const driveClip = path.join(driveRoot, 'DJI_0003.MP4');
    fs.writeFileSync(localKept, 'video-1');
    fs.writeFileSync(localDeleted, 'video-2');
    fs.writeFileSync(driveClip, 'video-3');
    fs.writeFileSync(path.join(driveRoot, 'DJI_0003.SRT'), SRT_SAMPLE);

    let roots = [onlineRoot, driveRoot];
    const service = createArchiveService({
      getRoots: () => roots,
      addRootState: (dir) => {
        roots = [...roots, dir];
        return roots;
      },
      removeRootState: (dir) => {
        roots = roots.filter((r) => r !== dir);
        return roots;
      },
      deps: {
        dbPath,
        getTools: async () => TOOLS,
      },
    });

    await expect(service.scan()).resolves.toEqual({ scanned: 3 });
    expect(mockedProbe).toHaveBeenCalledTimes(3);
    expect(service.clipAvailability(localKept)).toBe('online');
    expect(service.clipAvailability(driveClip)).toBe('online');
    expect(service.clipAvailability(path.join(base, 'unknown.mp4'))).toBeNull();

    // Delete one file from the connected local drive and unplug the external drive.
    fs.rmSync(localDeleted);
    fs.renameSync(driveRoot, displacedDrive);

    await expect(service.scan()).resolves.toEqual({ scanned: 1 });
    const afterUnplug = service.query();
    expect(afterUnplug.totalCount).toBe(2);
    expect(afterUnplug.offlineCount).toBe(1);
    expect(afterUnplug.offlineRoots).toEqual([driveRoot]);
    const clipsAfterUnplug = afterUnplug.flights.flatMap((f) => f.clips);
    expect(clipsAfterUnplug.find((c) => c.path === localDeleted)).toBeUndefined();
    const offlineRecord = clipsAfterUnplug.find((c) => c.path === driveClip);
    expect(offlineRecord?.availability).toBe('offline');
    expect(offlineRecord?.status).toBe('ok');
    expect(offlineRecord?.telemetry?.fixCount).toBe(2);
    expect(offlineRecord?.track.length).toBeGreaterThan(0);
    expect(service.clipAvailability(driveClip)).toBe('offline');

    // Reconnect the external drive: clip becomes online again without re-probing.
    fs.renameSync(displacedDrive, driveRoot);
    await expect(service.scan()).resolves.toEqual({ scanned: 2 });
    expect(mockedProbe).toHaveBeenCalledTimes(3);
    const afterReconnect = service.query();
    expect(afterReconnect.offlineCount).toBe(0);
    expect(afterReconnect.offlineRoots).toBeUndefined();
    expect(service.clipAvailability(driveClip)).toBe('online');

    // Unplug again, scan to mark offline, then explicitly prune offline clips.
    fs.renameSync(driveRoot, displacedDrive);
    await service.scan();
    expect(service.pruneOffline()).toBe(1);
    expect(service.pruneOffline()).toBe(0);
    const afterPrune = service.query();
    expect(afterPrune.totalCount).toBe(1);
    expect(afterPrune.offlineCount).toBe(0);
    expect(afterPrune.flights.flatMap((f) => f.clips).map((c) => c.path)).toEqual([localKept]);
  });
});
