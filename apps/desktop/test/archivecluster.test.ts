import { describe, expect, it } from 'vitest';

import type { ArchiveFlightDto } from '../shared/ipc.js';
import {
  ARCHIVE_CLUSTER_MAX_ZOOM,
  clusterArchiveClips,
  computeItemsBounds,
  extractClipSpatialItems,
} from '../ui/lib/archivecluster.js';

function makeFlight(
  flightId: string,
  clips: { path: string; lat: number; lon: number; withBbox?: boolean }[],
): ArchiveFlightDto {
  return {
    flightId,
    clips: clips.map(({ path, lat, lon, withBbox = true }) => ({
      path,
      size: 1024,
      mtimeMs: 1000,
      status: 'ok',
      availability: 'online',
      video: {
        fps: { num: 30, den: 1, value: 30, str: '30' },
        frames: 90,
        width: 1920,
        height: 1080,
        durationSec: 3,
      },
      cameraCreationTime: '2026-01-01T10:00:00Z',
      telemetry: {
        source: 'srt',
        method: 'srt-cues',
        fixCount: 2,
        noLock: 0,
        trackDistanceM: 85,
      },
      bbox: withBbox ? { minLat: lat, maxLat: lat + 0.002, minLon: lon, maxLon: lon + 0.002 } : null,
      track: [
        [
          { lat, lon, tSec: 0 },
          { lat: lat + 0.002, lon: lon + 0.002, tSec: 3 },
        ],
      ],
      error: null,
      splitFromKey: null,
    })),
  };
}

describe('extractClipSpatialItems & computeItemsBounds', () => {
  it('extracts centroids from bbox or track fallback and skips non-GPS clips', () => {
    const flights: ArchiveFlightDto[] = [
      makeFlight('f1', [{ path: 'a.mp4', lat: 46.6, lon: 14.2 }]),
      makeFlight('f2', [{ path: 'b.mp4', lat: 47.0, lon: 15.0, withBbox: false }]),
      {
        flightId: 'f3',
        clips: [
          {
            ...makeFlight('f3', [{ path: 'nogps.mp4', lat: 0, lon: 0 }]).clips[0],
            status: 'no-telemetry',
            telemetry: null,
            bbox: null,
            track: [],
          },
        ],
      },
    ];

    const items = extractClipSpatialItems(flights);
    expect(items.map((item) => item.clip.path)).toEqual(['a.mp4', 'b.mp4']);
    expect(items[0].flightIndex).toBe(0);
    expect(items[1].flightIndex).toBe(1);
    expect(items[0].lat).toBeCloseTo(46.601, 5);
    expect(items[0].lon).toBeCloseTo(14.201, 5);

    expect(computeItemsBounds(items)).toEqual({
      minLat: 46.6,
      maxLat: 47.002,
      minLon: 14.2,
      maxLon: 15.002,
    });
    expect(computeItemsBounds([])).toBeNull();
  });
});

describe('clusterArchiveClips', () => {
  it('returns empty results for empty input', () => {
    expect(clusterArchiveClips([], 8)).toEqual({ clusters: [], items: [] });
  });

  it('leaves all clips unclustered above ARCHIVE_CLUSTER_MAX_ZOOM', () => {
    const items = extractClipSpatialItems([
      makeFlight('f1', [
        { path: 'a.mp4', lat: 46.6, lon: 14.2 },
        { path: 'b.mp4', lat: 46.6001, lon: 14.2001 },
      ]),
    ]);
    const result = clusterArchiveClips(items, ARCHIVE_CLUSTER_MAX_ZOOM + 1);
    expect(result.clusters).toEqual([]);
    expect(result.items).toHaveLength(2);
  });

  it('clusters nearby centroids at low zoom and keeps distant ones separate', () => {
    const items = extractClipSpatialItems([
      makeFlight('f1', [
        { path: 'near-1.mp4', lat: 46.6, lon: 14.2 },
        { path: 'near-2.mp4', lat: 46.605, lon: 14.205 },
      ]),
      makeFlight('f2', [{ path: 'far.mp4', lat: 52.5, lon: 13.4 }]),
    ]);

    const result = clusterArchiveClips(items, 7);
    expect(result.clusters).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].clip.path).toBe('far.mp4');

    const [cluster] = result.clusters;
    expect(cluster.count).toBe(2);
    expect(cluster.clipPaths).toEqual(['near-1.mp4', 'near-2.mp4']);
    expect(cluster.bounds).toEqual({
      minLat: 46.6,
      maxLat: 46.607,
      minLon: 14.2,
      maxLon: 14.207,
    });
    expect(cluster.lat).toBeGreaterThan(46.6);
    expect(cluster.lon).toBeGreaterThan(14.2);
  });

  it('is deterministic and fast for 600+ clips across input permutations', () => {
    const clips = Array.from({ length: 650 }, (_, idx) => ({
      path: `clip-${String(idx).padStart(4, '0')}.mp4`,
      lat: 45 + (idx % 12) * 0.4 + Math.floor(idx / 12) * 0.001,
      lon: 10 + (idx % 15) * 0.4 + Math.floor(idx / 15) * 0.001,
    }));
    const items = extractClipSpatialItems([makeFlight('bulk', clips)]);
    const reversed = [...items].reverse();

    const start = performance.now();
    const first = clusterArchiveClips(items, 8);
    const elapsedMs = performance.now() - start;
    const second = clusterArchiveClips(reversed, 8);

    expect(first).toEqual(second);
    expect(elapsedMs).toBeLessThan(200);
    const totalCount =
      first.items.length + first.clusters.reduce((acc, cluster) => acc + cluster.count, 0);
    expect(totalCount).toBe(650);
    expect(first.clusters.length).toBeGreaterThan(0);
  });
});
