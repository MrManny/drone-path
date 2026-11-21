import fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { cleanupTmpDirs, probeFixture, tmpDir } from '../../../test/fixtures/core.js';
import { exportArchiveMap, exportArchiveTracks } from '../src/export.js';
import { listArchiveFlights } from '../src/query.js';
import { ArchiveStore, CLIP_FINGERPRINT_VERSION } from '../src/store.js';
import type { ClipUpdate } from '../src/store.js';

afterEach(cleanupTmpDirs);

function clip(key: string, start: string, lons: number[], availability: ClipUpdate['availability']): ClipUpdate {
  const track = lons.map((lon, index) => ({ lat: 0, lon, tSec: index * 20 }));
  return {
    key, availability, overview: [track],
    samples: track.map((point) => ({ ...point, segment: 0 })),
    gaze: [{ tSec: 0, polygon: [
      { lat: 0, lon: 0 }, { lat: 0, lon: 0.002 }, { lat: 0.003, lon: 0.002 }, { lat: 0.003, lon: 0 },
    ] }],
    fingerprint: { size: 1, mtimeMs: 0, srtSize: null, srtMtimeMs: null, schemaVersion: CLIP_FINGERPRINT_VERSION },
    record: {
      path: key, size: 1, mtimeMs: 0, cameraCreationTime: start,
      video: { ...probeFixture(), durationSec: (lons.length - 1) * 20 }, status: 'ok',
      telemetry: { source: 'cammeta', method: 'dvtm-packets', fixCount: lons.length, noLock: 0, trackDistanceM: 200 },
      bbox: { minLat: 0, maxLat: 0, minLon: Math.min(...lons), maxLon: Math.max(...lons) },
      track: [track], error: null,
    },
  };
}

function fixture() {
  const dir = tmpDir();
  const db = path.join(dir, 'archive.sqlite');
  const store = new ArchiveStore(db);
  try {
    store.commit(0, [
      clip('/private/DJI_0001.MP4', '2025-01-01T00:00:00Z', [0, 0.004], 'offline'),
      clip('/private/DJI_0002.MP4', '2025-01-01T00:00:21Z', [0.004, 0.0002, 0.02, 0.03, 0.01], 'online'),
      clip('/separate/plan.MP4', '2025-01-03T00:00:00Z', [40, 41], 'online'),
    ], [], [], []);
  } finally {
    store.close();
  }
  return { dir, db };
}

it.each([
  ['gpx', /<trk>/gu],
  ['geojson', /"type": "Feature"/gu],
  ['kml', /<Folder>/gu],
  ['kmz', null],
] as const)('writes deterministic multi-flight %s', (format, flightPattern) => {
  const { dir, db } = fixture();
  const out = path.join(dir, 'flights.' + format);
  exportArchiveTracks(db, out);
  const bytes = fs.readFileSync(out);
  if (flightPattern) expect(bytes.toString('utf8').match(flightPattern)).toHaveLength(2);
  else expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(bytes.toString()).not.toContain('2025-01');
  exportArchiveTracks(db, out);
  expect(fs.readFileSync(out)).toEqual(bytes);
});

it('uses filtered clip selection but protects full-flight endpoints and removes identifying map fields', () => {
  const { dir, db } = fixture();
  const groups = listArchiveFlights(db);
  expect(groups.map(({ clips }) => clips.length)).toEqual([2, 1]);
  const out = path.join(dir, 'flights.html');
  const filters = { availability: 'online' as const, beforeMs: Date.parse('2025-01-02') };
  exportArchiveMap(db, out, { filters, includeGaze: true });
  const raw = fs.readFileSync(out, 'utf8');
  expect(raw).toContain('DJI_0002.MP4');
  expect(raw).not.toContain('DJI_0001.MP4');
  expect(raw).not.toContain('/private/');
  expect(raw).toContain('"gaze":[[');
  exportArchiveMap(db, out, { filters, redactLaunchM: 100, includeGaze: true });
  const text = fs.readFileSync(out, 'utf8');
  expect(text).toContain('"track":[[{"lat":0,"lon":0.004}],[{"lat":0,"lon":0.02},{"lat":0,"lon":0.03}]]');
  expect(text).toContain('"gaze":[]');
  expect(text).not.toContain('DJI_0002.MP4');
  expect(text).not.toContain('2025-01');
  expect(listArchiveFlights(db)).toEqual(groups);
  exportArchiveTracks(db, path.join(dir, 'safe.geojson'), { filters, redactLaunchM: 100 });
  const geojson = JSON.parse(fs.readFileSync(path.join(dir, 'safe.geojson'), 'utf8')) as {
    features: { geometry: { coordinates: number[][][] } }[];
  };
  expect(geojson.features.map(({ geometry }) => geometry.coordinates)).toEqual([[[[0.004, 0], [0.004, 0]], [[0.02, 0], [0.03, 0]]]]);
});

it('rejects unsupported formats and prevents overwriting the archive at a custom filename', () => {
  const dir = tmpDir();
  const db = path.join(dir, 'archive.geojson');
  expect(() => exportArchiveTracks(db, path.join(dir, 'output.json'))).toThrow('expected a .gpx');
  expect(() => exportArchiveTracks(db, db)).toThrow('cannot overwrite the archive database');
  expect(listArchiveFlights(db)).toEqual([]);
});
