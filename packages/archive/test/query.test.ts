import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';
import { listArchive, nearArchive, parseDateBound } from '../src/query.js';
import type { SparseSample } from '../src/scan-track.js';
import { ARCHIVE_SCHEMA_VERSION, ArchiveStore } from '../src/store.js';
import type { ClipUpdate } from '../src/store.js';

afterEach(cleanupTmpDirs);

const time = '2025-02-02T06:00:00+06:00';

function clip(
  key: string, samples: SparseSample[], availability: ClipUpdate['availability'] = 'online',
  cameraCreationTime: string | null = time, trackDistanceM = 500,
): ClipUpdate {
  const lat = samples.map((sample) => sample.lat);
  const lon = samples.map((sample) => sample.lon);
  const mtimeMs = Date.parse('2025-02-02');
  return {
    key, availability, samples, overview: [],
    fingerprint: { size: 1, mtimeMs, srtSize: null, srtMtimeMs: null, schemaVersion: ARCHIVE_SCHEMA_VERSION },
    record: {
      path: key, size: 1, mtimeMs, cameraCreationTime, video: null,
      status: samples.length ? 'ok' : 'no-telemetry',
      telemetry: samples.length ? {
        source: 'srt', method: 'srt-cues', fixCount: samples.length, noLock: 0, trackDistanceM,
      } : null,
      bbox: samples.length ? {
        minLat: Math.min(...lat), maxLat: Math.max(...lat),
        minLon: Math.min(...lon), maxLon: Math.max(...lon),
      } : null,
      track: [], error: null,
    },
  };
}

function index(...clips: ClipUpdate[]): string {
  const db = path.join(tmpDir(), 'archive.sqlite');
  const store = new ArchiveStore(db);
  try {
    store.commit(0, clips, [], [], []);
  } finally {
    store.close();
  }
  return db;
}

it('combines inclusive bbox, date, distance, and offline availability filters', () => {
  const points = [{ lat: 30, lon: -179, tSec: 1, segment: 0 }];
  const db = index(
    clip('z', points, 'offline'),
    clip('no-zone', points, 'offline', '2025-02-02T00:00:00'),
    clip('no-tag', points, 'offline', null),
    clip('invalid-tag', points, 'offline', '2025-02-30T00:00:00Z'),
    clip('too-early', points, 'offline', '2025-02-01T23:59:59Z'),
    clip('upper-bound', points, 'offline', '2025-02-03T00:00:00Z'),
    clip('too-short', points, 'offline', time, 499),
    clip('online', points),
    clip('no-track', [], 'offline'),
    clip('a', [{ ...points[0], lon: 175 }], 'offline'),
    clip('outside', [{ ...points[0], lon: 170 }], 'offline'),
  );
  expect(listArchive(db, {
    bbox: { minLat: 29, maxLat: 30, minLon: 175, maxLon: -179 },
    afterMs: parseDateBound('2025-02-02'),
    beforeMs: parseDateBound('2025-02-03'),
    minDistanceM: 500,
    availability: 'offline',
  }).map(({ path: name, availability }) => [name, availability])).toEqual([['a', 'offline'], ['z', 'offline']]);
  expect(listArchive(db)).toHaveLength(11);
});

it('ranks near clips, includes offline data, and does not interpolate over gaps', () => {
  const samples = [
    { lat: 1, lon: 179.99, tSec: 2, segment: 0 },
    { lat: 1, lon: -179.99, tSec: 10, segment: 0 },
  ];
  const db = index(
    clip('second', [{ lat: 1.0005, lon: 179.9999, tSec: 3, segment: 0 }]),
    clip('tie', samples, 'offline'),
    clip('first', samples),
    clip('gap', [samples[0], { ...samples[1], segment: 1 }]),
    clip('none', []),
  );
  const hits = nearArchive(db, { lat: 1, lon: 180 }, 100);
  expect(hits.map(({ clip: { path: name }, matchType }) => [name, matchType])).toEqual([
    ['first', 'track'], ['tie', 'track'], ['second', 'track'],
  ]);
  expect(hits[0].tSec).toBeCloseTo(6, 8);
  expect(hits[1].clip.availability).toBe('offline');
  expect(hits[2].tSec).toBe(3);
  expect(nearArchive(db, { lat: -30, lon: 0 }, 100)).toEqual([]);
});

it('keeps arcs that reach outside the raw latitude bounds in the SQL prefilter', () => {
  const db = index(clip('arc', [
    { lat: 60, lon: -60, tSec: 2, segment: 0 },
    { lat: 60, lon: 60, tSec: 10, segment: 0 },
  ]));
  const lat = Math.atan(Math.tan(Math.PI / 3) / 0.5) * 180 / Math.PI;
  const hits = nearArchive(db, { lat, lon: 0 }, 1);
  expect(hits).toHaveLength(1);
  expect(hits[0].tSec).toBeCloseTo(6, 8);
});

it.each(['2025-02-30', '2025-02-30T00:00:00Z', '2025-02-02T00:00', '02/02/2025'])(
  'rejects ambiguous or invalid date bound %s',
  (value) => expect(() => parseDateBound(value)).toThrow('expected an ISO date'),
);
