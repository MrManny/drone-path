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

describe.each([1, 2, 3])('migrating archive schema v%i to v4', (sourceVersion) => {
  it('adds segments schema and marks existing ok clips as segmentsPending', () => {
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
      const okRecord = JSON.stringify({
        path: 'ok.mp4', size: 1, mtimeMs: 1, status: 'ok', video: null,
        cameraCreationTime: null, telemetry: { source: 'srt', method: 'srt-cues', fixCount: 1, noLock: 0, trackDistanceM: 0 },
        bbox: null, track: [], error: null,
      });
      const noTelRecord = JSON.stringify({
        path: 'notel.mp4', size: 1, mtimeMs: 1, status: 'no-telemetry', video: null,
        cameraCreationTime: null, telemetry: null, bbox: null, track: [], error: null,
      });
      legacy.prepare('INSERT INTO clips VALUES (?, ?, 1, 1, NULL, NULL, 1, NULL, NULL, NULL, NULL, ?, ?)').run('ok.mp4', 'online', okRecord, '[]');
      legacy.prepare('INSERT INTO clips VALUES (?, ?, 1, 1, NULL, NULL, 1, NULL, NULL, NULL, NULL, ?, ?)').run('notel.mp4', 'online', noTelRecord, '[]');
      legacy.exec(`PRAGMA user_version = ${sourceVersion}`);
    } finally {
      legacy.close();
    }

    const store = new ArchiveStore(file);
    try {
      const snap = store.snapshot();
      expect(snap.clips.map(({ key, segmentsPending }) => [key, segmentsPending])).toEqual([
        ['notel.mp4', false],
        ['ok.mp4', true],
      ]);
      expect(store.readSegments('ok.mp4')).toEqual([]);
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
    } finally {
      check.close();
    }
  });
});
