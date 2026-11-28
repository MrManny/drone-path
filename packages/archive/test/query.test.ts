import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { cleanupTmpDirs, probeFixture, tmpDir } from '../../../test/fixtures/core.js';
import {
  listArchive,
  listArchiveFlightOverviews,
  listArchiveFlights,
  listArchiveSegments,
  nearArchive,
  parseDateBound,
  pruneArchiveOffline,
} from '../src/query.js';
import type { SparseSample } from '../src/scan-track.js';
import { ArchiveStore, CLIP_FINGERPRINT_VERSION } from '../src/store.js';
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
    fingerprint: { size: 1, mtimeMs, srtSize: null, srtMtimeMs: null, schemaVersion: CLIP_FINGERPRINT_VERSION },
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

it('lists an indexed antimeridian crossing in a narrow wrapped viewport and excludes it near Greenwich', () => {
  const db = index(
    clip('crossing', [
      { lat: 10, lon: 179, tSec: 1, segment: 0 },
      { lat: 10, lon: -179, tSec: 2, segment: 0 },
    ]),
    clip('greenwich', [{ lat: 10, lon: 0, tSec: 1, segment: 0 }]),
  );
  const viewport = { minLat: 9, maxLat: 11 };
  expect(listArchive(db, {
    bbox: { ...viewport, minLon: 179.5, maxLon: -179.5 },
  }).map(({ path: name }) => name)).toEqual(['crossing']);
  expect(listArchive(db, {
    bbox: { ...viewport, minLon: -0.5, maxLon: 0.5 },
  }).map(({ path: name }) => name)).toEqual(['greenwich']);
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

it('assembles filtered flight members in recording order with their split predecessor', () => {
  const samples = [{ lat: 46, lon: 14, tSec: 0, segment: 0 }, { lat: 46.0002, lon: 14, tSec: 20, segment: 0 }];
  const first = clip('DJI_9999.MP4', samples, 'offline');
  first.record.video = probeFixture({ durationSec: 20 });
  first.fingerprint.size = first.record.size = 4_000_000_000;
  const next = clip('DJI_0000.MP4', [
    { ...samples[1], tSec: 0 }, { ...samples[1], tSec: 15 },
  ], 'online', '2025-02-02T00:00:20Z');
  next.record.video = probeFixture({ durationSec: 15 });
  const db = index(next, first);
  const [flight] = listArchiveFlights(db);
  expect(listArchiveFlights(db)).toEqual([{
    flightId: expect.any(String),
    clips: [
      { ...first.record, availability: 'offline', splitFromKey: null },
      { ...next.record, availability: 'online', splitFromKey: first.key },
    ],
  }]);
  expect(listArchiveFlights(db, { availability: 'online' })).toEqual([{ ...flight, clips: [flight.clips[1]] }]);
  expect(listArchiveFlightOverviews(db, { afterMs: Date.parse('2025-02-02T00:00:01Z') })).toEqual([
    { ...flight, clips: [flight.clips[1]], startMs: Date.parse(time) },
  ]);
  expect(listArchive(db)).toEqual([
    { ...next.record, availability: 'online' }, { ...first.record, availability: 'offline' },
  ]);

  const store = new ArchiveStore(db);
  try {
    store.commit(store.snapshot().revision, [], [], [], [first.key]);
  } finally {
    store.close();
  }
  const [remaining] = listArchiveFlights(db);
  expect(remaining.flightId).not.toBe(flight.flightId);
  expect(remaining.clips).toEqual([{ ...next.record, availability: 'online', splitFromKey: null }]);
});
it('finds a gaze match outside the track radius without adding gaze to SRT clips', () => {
  const point = { lat: 45, lon: -180 };
  const far = { lat: 45.004, lon: 179.999, tSec: 7, segment: 0 };
  const dvtm = clip('dvtm', [far], 'offline');
  dvtm.record.telemetry = {
    source: 'cammeta', method: 'dvtm-packets', fixCount: 1, noLock: 0, trackDistanceM: 0,
  };
  dvtm.gaze = [
    { tSec: 7, polygon: [
      { lat: 44.999, lon: 179.999 }, { lat: 44.999, lon: -179.999 },
      { lat: 45.001, lon: -179.999 }, { lat: 45.001, lon: 179.999 },
    ] },
  ];
  const db = index(dvtm, clip('srt', [far]));
  expect(nearArchive(db, point, 15)).toEqual([]);
  expect(nearArchive(db, point, 15, true)).toMatchObject([
    { clip: { path: 'dvtm', availability: 'offline' }, matchType: 'gaze', tSec: 7, distanceM: 0 },
  ]);
  expect(nearArchive(db, { lat: 45, lon: 0 }, 15, true)).toEqual([]);
  expect(nearArchive(db, point, 500, true).map(({ matchType }) => matchType)).toEqual(['gaze', 'track', 'track']);
});

it('lists and filters ranked segments and matching clips/flights', () => {
  const points = [{ lat: 46, lon: 14, tSec: 1, segment: 0 }];
  const alpha = clip('alpha.mp4', points, 'online');
  alpha.segments = [
    {
      type: 'smooth-glide', startSec: 0, endSec: 5, durationSec: 5,
      smoothness: 0.72, exposureStable: true, meanSpeedMps: 4, meanYawRateDegPerSec: 0.5,
    },
    {
      type: 'reposition', startSec: 5, endSec: 8, durationSec: 3,
      smoothness: 0.3, exposureStable: false, meanSpeedMps: 7, meanYawRateDegPerSec: 60,
    },
  ];
  const beta = clip('beta.mp4', points, 'offline');
  beta.segments = [
    {
      type: 'smooth-glide', startSec: 2, endSec: 9, durationSec: 7,
      smoothness: 0.94, exposureStable: true, meanSpeedMps: 5, meanYawRateDegPerSec: 0.1,
    },
    {
      type: 'smooth-glide', startSec: 10, endSec: 14, durationSec: 4,
      smoothness: 0.65, exposureStable: true, meanSpeedMps: 4.5, meanYawRateDegPerSec: 0.2,
    },
  ];
  const gamma = clip('gamma.mp4', points, 'online');
  gamma.segments = [
    {
      type: 'hover', startSec: 0, endSec: 6, durationSec: 6,
      smoothness: 0.98, exposureStable: true, meanSpeedMps: 0.1, meanYawRateDegPerSec: 0,
    },
  ];
  const db = index(alpha, beta, gamma);

  const ranked = listArchiveSegments(db, { segmentType: 'smooth-glide', minSmoothness: 0.7 });
  expect(ranked.map(({ clip: c, smoothness, startSec }) => [c.path, smoothness, startSec])).toEqual([
    ['beta.mp4', 0.94, 2],
    ['alpha.mp4', 0.72, 0],
  ]);
  expect(listArchiveSegments(db, { segmentType: 'smooth-glide', availability: 'online' })).toHaveLength(1);
  expect(listArchive(db, { segmentType: 'smooth-glide', minSmoothness: 0.8 }).map(({ path: p }) => p)).toEqual(['beta.mp4']);
  expect(listArchiveFlights(db, { segmentType: 'hover' }).map(({ clips }) => clips[0].path)).toEqual(['gamma.mp4']);
  expect(() => listArchiveSegments(db, { minSmoothness: 1.5 })).toThrow('expected a smoothness score between 0 and 1');
});

it('lists decimated flight overviews without transferring full 500-point tracks', () => {
  const fullSegment = Array.from({ length: 100 }, (_, i) => ({
    lat: 46.6 + i * 0.0001,
    lon: 14.2 + i * 0.0001,
    tSec: i,
  }));
  const overviewSegment = [fullSegment[0], fullSegment[50], fullSegment[99]];
  const sample = clip('flight.mp4', [
    { lat: 46.6, lon: 14.2, tSec: 0, segment: 0 },
    { lat: 46.6099, lon: 14.2099, tSec: 99, segment: 0 },
  ]);
  sample.record.track = [fullSegment];
  sample.overview = [overviewSegment];

  const db = index(sample);
  const fullFlights = listArchiveFlights(db);
  expect(fullFlights[0].clips[0].track[0]).toHaveLength(100);

  const overviewFlights = listArchiveFlightOverviews(db);
  expect(overviewFlights).toHaveLength(1);
  expect(overviewFlights[0].clips[0].track).toEqual([overviewSegment]);
  expect(listArchiveFlights(db, {}, { overview: true })[0].clips[0].track).toEqual([overviewSegment]);
});

it('prunes offline clips via pruneArchiveOffline while keeping online clips intact', () => {
  const points = [{ lat: 46, lon: 14, tSec: 1, segment: 0 }];
  const db = index(
    clip('keep.mp4', points, 'online'),
    clip('gone-1.mp4', points, 'offline'),
    clip('gone-2.mp4', points, 'offline'),
  );
  expect(pruneArchiveOffline(db)).toBe(2);
  expect(listArchive(db).map(({ path: p }) => p)).toEqual(['keep.mp4']);
  expect(pruneArchiveOffline(db)).toBe(0);
});
