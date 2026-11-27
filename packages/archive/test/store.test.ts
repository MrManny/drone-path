import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';
import { ARCHIVE_SCHEMA_VERSION, ArchiveStore } from '../src/store.js';

afterEach(cleanupTmpDirs);

it('opens and reads a current archive while another connection holds a write reservation', () => {
  const file = path.join(tmpDir(), 'archive.sqlite');
  new ArchiveStore(file).close();
  const writer = new DatabaseSync(file);
  try {
    writer.exec('BEGIN IMMEDIATE');
    const reader = new ArchiveStore(file);
    try {
      expect(reader.listClips()).toEqual([]);
    } finally {
      reader.close();
    }
  } finally {
    writer.close();
  }
});

it('rejects an unsupported database schema and leaves its version intact', () => {
  const file = path.join(tmpDir(), 'archive.sqlite');
  const newer = ARCHIVE_SCHEMA_VERSION + 1;
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA user_version = ${newer}`);
    expect(() => new ArchiveStore(file)).toThrow(`unsupported archive database schema version: ${newer}`);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(newer);
  } finally {
    db.close();
  }
});

it('does not initialize the archive in an existing database without an archive schema', () => {
  const file = path.join(tmpDir(), 'archive.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE other_app (value TEXT)');
    expect(() => new ArchiveStore(file)).toThrow('existing database has no archive schema');
    expect(db.prepare('SELECT name FROM sqlite_schema').all().map(({ name }) => name)).toEqual(['other_app']);
  } finally {
    db.close();
  }
});

describe.each([1, 2, 3, 4])('migrating archive schema v%i to v5', (sourceVersion) => {
  it('adds segments and sharpness schema while preserving existing clips', () => {
    const file = path.join(tmpDir(), 'archive.sqlite');
    const legacy = new DatabaseSync(file);
    try {
      legacy.exec(`
        CREATE TABLE archive_revision (revision INTEGER NOT NULL) STRICT;
        INSERT INTO archive_revision VALUES (1);
        CREATE TABLE clips (
          clip_key TEXT PRIMARY KEY,
          availability TEXT NOT NULL CHECK (availability IN ('online', 'offline')),
          size INTEGER NOT NULL,
          mtime_ms REAL NOT NULL,
          srt_size INTEGER,
          srt_mtime_ms REAL,
          schema_version INTEGER NOT NULL,
          min_lat REAL,
          min_lon REAL,
          max_lat REAL,
          max_lon REAL,
          record_json TEXT NOT NULL,
          overview_json TEXT NOT NULL
        ) STRICT;
        CREATE INDEX clips_bbox ON clips (min_lat, max_lat, min_lon, max_lon);
        CREATE TABLE clip_samples (
          clip_key TEXT NOT NULL REFERENCES clips (clip_key) ON DELETE CASCADE,
          segment INTEGER NOT NULL,
          sample_index INTEGER NOT NULL,
          t_sec REAL NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          PRIMARY KEY (clip_key, segment, sample_index)
        ) STRICT;
      `);
      if (sourceVersion >= 2) {
        legacy.exec(`
          CREATE TABLE clip_flights (
            clip_key TEXT PRIMARY KEY REFERENCES clips (clip_key) ON DELETE CASCADE,
            flight_id TEXT NOT NULL,
            flight_order INTEGER NOT NULL,
            split_from_key TEXT REFERENCES clips (clip_key) ON DELETE SET NULL
          ) STRICT;
        `);
      }
      if (sourceVersion >= 3) {
        legacy.exec(`
          CREATE TABLE clip_gaze (
            clip_key TEXT PRIMARY KEY REFERENCES clips (clip_key) ON DELETE CASCADE,
            min_lat REAL,
            max_lat REAL,
            min_lon REAL,
            max_lon REAL,
            samples_json TEXT NOT NULL
          ) STRICT;
        `);
      }
      if (sourceVersion >= 4) {
        legacy.exec(`
          ALTER TABLE clips ADD COLUMN segments_indexed INTEGER NOT NULL DEFAULT 0;
          CREATE TABLE segments (
            clip_key TEXT NOT NULL REFERENCES clips (clip_key) ON DELETE CASCADE,
            segment_index INTEGER NOT NULL,
            segment_type TEXT NOT NULL,
            start_sec REAL NOT NULL,
            end_sec REAL NOT NULL,
            duration_sec REAL NOT NULL,
            smoothness REAL NOT NULL,
            exposure_stable INTEGER NOT NULL,
            mean_speed_mps REAL NOT NULL,
            mean_yaw_rate_deg_per_sec REAL NOT NULL,
            PRIMARY KEY (clip_key, segment_index)
          ) STRICT;
          CREATE INDEX segments_type_smoothness ON segments (segment_type, smoothness DESC);
        `);
      }
      const okRecord = JSON.stringify({
        path: 'ok.mp4', size: 1, mtimeMs: 1, status: 'ok', video: null,
        cameraCreationTime: null, telemetry: { source: 'srt', method: 'srt-cues', fixCount: 1, noLock: 0, trackDistanceM: 0 },
        bbox: null, track: [], error: null,
      });
      const noTelRecord = JSON.stringify({
        path: 'notel.mp4', size: 1, mtimeMs: 1, status: 'no-telemetry', video: null,
        cameraCreationTime: null, telemetry: null, bbox: null, track: [], error: null,
      });
      if (sourceVersion >= 4) {
        legacy.prepare('INSERT INTO clips VALUES (?, ?, 1, 1, NULL, NULL, 1, NULL, NULL, NULL, NULL, ?, ?, 1)').run('ok.mp4', 'online', okRecord, '[]');
        legacy.prepare('INSERT INTO clips VALUES (?, ?, 1, 1, NULL, NULL, 1, NULL, NULL, NULL, NULL, ?, ?, 0)').run('notel.mp4', 'online', noTelRecord, '[]');
      } else {
        legacy.prepare('INSERT INTO clips VALUES (?, ?, 1, 1, NULL, NULL, 1, NULL, NULL, NULL, NULL, ?, ?)').run('ok.mp4', 'online', okRecord, '[]');
        legacy.prepare('INSERT INTO clips VALUES (?, ?, 1, 1, NULL, NULL, 1, NULL, NULL, NULL, NULL, ?, ?)').run('notel.mp4', 'online', noTelRecord, '[]');
      }
      legacy.exec(`PRAGMA user_version = ${sourceVersion}`);
    } finally {
      legacy.close();
    }

    const store = new ArchiveStore(file);
    try {
      const snap = store.snapshot();
      expect(snap.clips.map(({ key, segmentsPending }) => [key, segmentsPending])).toEqual([
        ['notel.mp4', false],
        ['ok.mp4', sourceVersion < 4],
      ]);
      expect(store.readSegments('ok.mp4')).toEqual([]);
      expect(store.latestSharpnessRun('ok.mp4')).toBeNull();
    } finally {
      store.close();
    }

    const check = new DatabaseSync(file);
    try {
      expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(ARCHIVE_SCHEMA_VERSION);
      expect(check.prepare("SELECT name FROM sqlite_schema WHERE name = 'segments'").get()).toEqual({ name: 'segments' });
      expect(check.prepare("SELECT name FROM sqlite_schema WHERE name = 'segments_type_smoothness'").get()).toEqual({
        name: 'segments_type_smoothness',
      });
      expect(check.prepare("SELECT name FROM sqlite_schema WHERE name = 'sharpness_runs'").get()).toEqual({
        name: 'sharpness_runs',
      });
      expect(check.prepare("SELECT name FROM sqlite_schema WHERE name = 'sharpness_samples'").get()).toEqual({
        name: 'sharpness_samples',
      });
    } finally {
      check.close();
    }
  });
});

describe('ArchiveStore.removeClipsUnder', () => {
  function sampleClip(filePath: string, key = process.platform === 'win32' ? filePath.toLowerCase() : filePath) {
    return {
      key,
      availability: 'online' as const,
      fingerprint: { size: 100, mtimeMs: 1000, srtSize: null, srtMtimeMs: null, schemaVersion: 1 },
      record: {
        path: filePath,
        size: 100,
        mtimeMs: 1000,
        status: 'ok' as const,
        video: { fps: { num: 30, den: 1, value: 30, str: '30' }, frames: 90, width: 1920, height: 1080, durationSec: 3 },
        cameraCreationTime: '2026-01-01T10:00:00Z',
        telemetry: { source: 'srt' as const, method: 'srt-cues' as const, fixCount: 1, noLock: 0, trackDistanceM: 10 },
        bbox: { minLat: 46.6, maxLat: 46.6, minLon: 14.2, maxLon: 14.2 },
        track: [[{ lat: 46.6, lon: 14.2, tSec: 0 }]],
        error: null,
      },
      overview: [[{ lat: 46.6, lon: 14.2, tSec: 0 }]],
      samples: [{ segment: 0, lat: 46.6, lon: 14.2, tSec: 0 }],
      gaze: [{ tSec: 0, polygon: [{ lat: 46.6, lon: 14.2 }, { lat: 46.61, lon: 14.2 }, { lat: 46.61, lon: 14.21 }] }],
      segments: [{
        type: 'hover' as const,
        startSec: 0,
        endSec: 3,
        durationSec: 3,
        smoothness: 0.9,
        exposureStable: true,
        meanSpeedMps: 0.1,
        meanYawRateDegPerSec: 0.2,
      }],
    };
  }

  it('removes nested clips under the given root, cascades related rows, refreshes flights, and bumps revision', () => {
    const base = tmpDir();
    const rootA = path.join(base, 'flights');
    const rootOther = path.join(base, 'flights-archive');
    const dbFile = path.join(base, 'archive.sqlite');
    const store = new ArchiveStore(dbFile);
    try {
      const clip1 = sampleClip(path.join(rootA, 'day1', 'DJI_0001.MP4'));
      const clip2 = sampleClip(path.join(rootA, 'DJI_0002.MP4'));
      const clipOther = sampleClip(path.join(rootOther, 'DJI_0003.MP4'));
      store.commit(0, [clip1, clip2, clipOther], [], [], []);
      expect(store.snapshot().revision).toBe(1);

      const deleted = store.removeClipsUnder(rootA + path.sep);
      expect(deleted).toBe(2);

      const snap = store.snapshot();
      expect(snap.revision).toBe(2);
      expect(snap.clips.map((c) => c.record.path)).toEqual([clipOther.record.path]);
      expect(store.listClips().map((c) => c.record.path)).toEqual([clipOther.record.path]);
      expect(store.readSamples(clip1.key)).toEqual([]);
      expect(store.readSegments(clip1.key)).toEqual([]);
    } finally {
      store.close();
    }

    const raw = new DatabaseSync(dbFile);
    try {
      expect(raw.prepare('SELECT COUNT(*) AS count FROM clip_gaze').get()?.count).toBe(1);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM clip_flights').get()?.count).toBe(1);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM clip_samples').get()?.count).toBe(1);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM segments').get()?.count).toBe(1);
    } finally {
      raw.close();
    }
  });

  it('returns 0 and leaves revision unchanged when no clips match', () => {
    const base = tmpDir();
    const dbFile = path.join(base, 'archive.sqlite');
    const store = new ArchiveStore(dbFile);
    try {
      const clip = sampleClip(path.join(base, 'kept', 'DJI_0001.MP4'));
      store.commit(0, [clip], [], [], []);
      expect(store.removeClipsUnder(path.join(base, 'empty'))).toBe(0);
      expect(store.snapshot().revision).toBe(1);
      expect(store.snapshot().clips).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  if (process.platform === 'win32') {
    it('matches paths case-insensitively on win32', () => {
      const base = tmpDir();
      const dbFile = path.join(base, 'archive.sqlite');
      const store = new ArchiveStore(dbFile);
      try {
        const root = path.join(base, 'Flights');
        const clip = sampleClip(path.join(base, 'flights', 'DJI_0001.MP4'));
        store.commit(0, [clip], [], [], []);
        expect(store.removeClipsUnder(root.toUpperCase())).toBe(1);
        expect(store.snapshot().clips).toHaveLength(0);
      } finally {
        store.close();
      }
    });
  }
});

describe('ArchiveStore.listClipOverviews', () => {
  it('returns decimated overview tracks instead of full record.track and honors filters', () => {
    const base = tmpDir();
    const dbFile = path.join(base, 'archive.sqlite');
    const store = new ArchiveStore(dbFile);
    try {
      const fullTrack = Array.from({ length: 120 }, (_, i) => ({
        lat: 46.6 + i * 0.0001,
        lon: 14.2 + i * 0.0001,
        tSec: i,
      }));
      const overviewTrack = [
        [fullTrack[0], fullTrack[60], fullTrack[119]],
      ];
      const clipA = {
        key: 'a.mp4',
        availability: 'online' as const,
        fingerprint: { size: 100, mtimeMs: 1000, srtSize: null, srtMtimeMs: null, schemaVersion: 1 },
        record: {
          path: 'a.mp4',
          size: 100,
          mtimeMs: 1000,
          status: 'ok' as const,
          video: { fps: { num: 30, den: 1, value: 30, str: '30' }, frames: 3600, width: 1920, height: 1080, durationSec: 120 },
          cameraCreationTime: '2026-01-01T10:00:00Z',
          telemetry: { source: 'srt' as const, method: 'srt-cues' as const, fixCount: 120, noLock: 0, trackDistanceM: 420 },
          bbox: { minLat: 46.6, maxLat: 46.612, minLon: 14.2, maxLon: 14.212 },
          track: [fullTrack],
          error: null,
        },
        overview: overviewTrack,
        samples: [{ segment: 0, lat: 46.6, lon: 14.2, tSec: 0 }],
        segments: [{
          type: 'smooth-glide' as const,
          startSec: 0,
          endSec: 10,
          durationSec: 10,
          smoothness: 0.9,
          exposureStable: true,
          meanSpeedMps: 4,
          meanYawRateDegPerSec: 0.2,
        }],
      };
      const clipB = {
        ...clipA,
        key: 'b.mp4',
        availability: 'offline' as const,
        record: {
          ...clipA.record,
          path: 'b.mp4',
          bbox: { minLat: 10, maxLat: 10.01, minLon: 10, maxLon: 10.01 },
          track: [[{ lat: 10, lon: 10, tSec: 0 }]],
        },
        overview: [[{ lat: 10, lon: 10, tSec: 0 }]],
        samples: [{ segment: 0, lat: 10, lon: 10, tSec: 0 }],
        segments: undefined,
      };
      store.commit(0, [clipA, clipB], [], [], []);

      const full = store.listClips();
      expect(full[0].record.track[0]).toHaveLength(120);

      const overviews = store.listClipOverviews();
      expect(overviews).toHaveLength(2);
      expect(overviews[0].record.track).toEqual(overviewTrack);
      expect(overviews[0].record.telemetry).toEqual(clipA.record.telemetry);
      expect(overviews[0].flight.flightId).toBe(full[0].flight.flightId);

      expect(
        store.listClipOverviews(
          { minLat: 46.5, maxLat: 46.7, minLon: 14.1, maxLon: 14.3 },
          'online',
          { segmentType: 'smooth-glide', minSmoothness: 0.8 },
        ).map((c) => c.key),
      ).toEqual(['a.mp4']);
    } finally {
      store.close();
    }
  });
});

describe('ArchiveStore.pruneOffline', () => {
  function offlineOrOnlineClip(
    filePath: string,
    availability: 'online' | 'offline',
    cameraCreationTime = '2026-01-01T10:00:00Z',
    size = 100,
  ) {
    const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
    return {
      key,
      availability,
      fingerprint: { size, mtimeMs: 1000, srtSize: null, srtMtimeMs: null, schemaVersion: 1 },
      record: {
        path: filePath,
        size,
        mtimeMs: 1000,
        status: 'ok' as const,
        video: { fps: { num: 30, den: 1, value: 30, str: '30' }, frames: 90, width: 1920, height: 1080, durationSec: 3 },
        cameraCreationTime,
        telemetry: { source: 'srt' as const, method: 'srt-cues' as const, fixCount: 1, noLock: 0, trackDistanceM: 10 },
        bbox: { minLat: 46.6, maxLat: 46.6, minLon: 14.2, maxLon: 14.2 },
        track: [[{ lat: 46.6, lon: 14.2, tSec: 0 }]],
        error: null,
      },
      overview: [[{ lat: 46.6, lon: 14.2, tSec: 0 }, { lat: 46.6, lon: 14.2, tSec: 3 }]],
      samples: [
        { segment: 0, lat: 46.6, lon: 14.2, tSec: 0 },
        { segment: 0, lat: 46.6, lon: 14.2, tSec: 3 },
      ],
      gaze: [{ tSec: 0, polygon: [{ lat: 46.6, lon: 14.2 }, { lat: 46.61, lon: 14.2 }, { lat: 46.61, lon: 14.21 }] }],
      segments: [{
        type: 'hover' as const,
        startSec: 0,
        endSec: 3,
        durationSec: 3,
        smoothness: 0.9,
        exposureStable: true,
        meanSpeedMps: 0.1,
        meanYawRateDegPerSec: 0.2,
      }],
    };
  }

  it('deletes offline clips, cascades related rows, refreshes flights, and bumps revision', () => {
    const base = tmpDir();
    const dbFile = path.join(base, 'archive.sqlite');
    const store = new ArchiveStore(dbFile);
    try {
      const offlineA = offlineOrOnlineClip(path.join(base, 'DJI_0001.MP4'), 'offline', '2026-01-01T10:00:00Z', 4_000_000_000);
      const onlineB = offlineOrOnlineClip(path.join(base, 'DJI_0002.MP4'), 'online', '2026-01-01T10:00:03Z', 200);
      const offlineC = offlineOrOnlineClip(path.join(base, 'DJI_0003.MP4'), 'offline', '2026-01-01T12:00:00Z', 100);
      store.commit(0, [offlineA, onlineB, offlineC], [], [], []);
      expect(store.snapshot().revision).toBe(1);
      expect(store.listClips().find((c) => c.key === onlineB.key)?.flight.splitFromKey).toBe(offlineA.key);

      expect(store.pruneOffline()).toBe(2);

      const snap = store.snapshot();
      expect(snap.revision).toBe(2);
      expect(snap.clips.map((c) => c.key)).toEqual([onlineB.key]);
      const remaining = store.listClips();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.flight.splitFromKey).toBeNull();
      expect(store.readSamples(offlineA.key)).toEqual([]);
      expect(store.readSegments(offlineA.key)).toEqual([]);
      expect(store.pruneOffline()).toBe(0);
      expect(store.snapshot().revision).toBe(2);
    } finally {
      store.close();
    }

    const raw = new DatabaseSync(dbFile);
    try {
      expect(raw.prepare('SELECT COUNT(*) AS count FROM clip_gaze').get()?.count).toBe(1);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM clip_flights').get()?.count).toBe(1);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM clip_samples').get()?.count).toBe(2);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM segments').get()?.count).toBe(1);
    } finally {
      raw.close();
    }
  });
});

describe('ArchiveStore sharpness runs and samples', () => {
  function indexedClip(filePath: string) {
    const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
    return {
      key,
      availability: 'online' as const,
      fingerprint: { size: 500, mtimeMs: 2000, srtSize: null, srtMtimeMs: null, schemaVersion: 1 },
      record: {
        path: filePath,
        size: 500,
        mtimeMs: 2000,
        status: 'no-telemetry' as const,
        video: { fps: { num: 30, den: 1, value: 30, str: '30' }, frames: 90, width: 1920, height: 1080, durationSec: 3 },
        cameraCreationTime: null,
        telemetry: null,
        bbox: null,
        track: [],
        error: null,
      },
      overview: [],
      samples: [],
    };
  }

  it('saves runs atomically, supports time-range/paged reads, rolls back failed writes, and cascades on clip delete', () => {
    const base = tmpDir();
    const dbFile = path.join(base, 'archive.sqlite');
    const store = new ArchiveStore(dbFile);
    try {
      const clip = indexedClip(path.join(base, 'DJI_0001.MP4'));
      store.commit(0, [clip], [], [], []);
      expect(store.getClipByKey(clip.key)?.record.path).toBe(clip.record.path);

      const sampledSettings = JSON.stringify({
        mode: 'sampled',
        stride: 30,
        analysisWidth: 640,
        minEdgeCoverage: 0.002,
      });
      const everySettings = JSON.stringify({
        mode: 'every-frame',
        stride: 1,
        analysisWidth: 640,
        minEdgeCoverage: 0.002,
      });

      const run1 = store.saveSharpnessRun({
        clipKey: clip.key,
        fingerprintKey: '{"size":500,"mtimeMs":2000}',
        method: 'ffmpeg-blurdetect',
        version: '1',
        settingsJson: sampledSettings,
        analyzedAtMs: 1000,
        samples: [
          { frameIndex: 0, tSec: 0, sharpnessScore: 45.2, edgeCoverage: 0.01 },
          { frameIndex: 30, tSec: 1, sharpnessScore: null, edgeCoverage: 0.0005 },
          { frameIndex: 60, tSec: 2, sharpnessScore: 52.1, edgeCoverage: 0.02 },
        ],
      });
      const run2 = store.saveSharpnessRun({
        clipKey: clip.key,
        fingerprintKey: '{"size":500,"mtimeMs":2000}',
        method: 'ffmpeg-blurdetect',
        version: '1',
        settingsJson: everySettings,
        analyzedAtMs: 2000,
        samples: [
          { frameIndex: 0, tSec: 0, sharpnessScore: 45.2, edgeCoverage: 0.01 },
          { frameIndex: 1, tSec: 0.033, sharpnessScore: 44.8, edgeCoverage: 0.01 },
        ],
      });

      expect(store.findSharpnessRun({
        clipKey: clip.key,
        fingerprintKey: '{"size":500,"mtimeMs":2000}',
        method: 'ffmpeg-blurdetect',
        version: '1',
        settingsJson: sampledSettings,
      })).toEqual(run1);
      expect(store.latestSharpnessRun(clip.key)).toEqual(run2);
      expect(store.latestSharpnessRun(clip.key, { mode: 'sampled' })).toEqual(run1);
      expect(store.countSharpnessSamples(run1.runId, { startSec: 0.5, endSec: 2 })).toBe(2);
      expect(store.readSharpnessSamples(run1.runId, { startSec: 0.5, endSec: 2, limit: 1, offset: 1 })).toEqual([
        { frameIndex: 60, tSec: 2, sharpnessScore: 52.1, edgeCoverage: 0.02 },
      ]);

      // Duplicate frame_index fails PK constraint midway and must roll back the entire run atomically.
      expect(() =>
        store.saveSharpnessRun({
          clipKey: clip.key,
          fingerprintKey: '{"size":500,"mtimeMs":2001}',
          method: 'ffmpeg-blurdetect',
          version: '1',
          settingsJson: sampledSettings,
          analyzedAtMs: 3000,
          samples: [
            { frameIndex: 0, tSec: 0, sharpnessScore: 50, edgeCoverage: 0.02 },
            { frameIndex: 0, tSec: 0, sharpnessScore: 51, edgeCoverage: 0.02 },
          ],
        }),
      ).toThrow();
      expect(store.latestSharpnessRun(clip.key)).toEqual(run2);

      // Deleting the clip cascades to sharpness_runs and sharpness_samples.
      store.commit(1, [], [], [], [clip.key]);
      expect(store.latestSharpnessRun(clip.key)).toBeNull();
      expect(store.readSharpnessSamples(run1.runId)).toEqual([]);
    } finally {
      store.close();
    }

    const raw = new DatabaseSync(dbFile);
    try {
      expect(raw.prepare('SELECT COUNT(*) AS count FROM sharpness_runs').get()?.count).toBe(0);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM sharpness_samples').get()?.count).toBe(0);
    } finally {
      raw.close();
    }
  });
});
