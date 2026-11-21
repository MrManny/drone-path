import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

import type { Bbox } from 'drone-path-core/geo';
import { longitudeRanges } from 'drone-path-core/spatial';

import type { ScanPoint, SparseSample } from './scan-track.js';
import type { ScanRecord } from './scanner.js';

export const ARCHIVE_SCHEMA_VERSION = 1;

export interface ClipFingerprint {
  size: number;
  mtimeMs: number;
  srtSize: number | null;
  srtMtimeMs: number | null;
  schemaVersion: number;
}

export interface IndexedClip {
  key: string;
  record: ScanRecord;
  fingerprint: ClipFingerprint;
  availability: 'online' | 'offline';
}

export interface ClipUpdate extends IndexedClip {
  overview: ScanPoint[][];
  samples: SparseSample[];
}

interface ClipRow {
  clip_key: string;
  availability: IndexedClip['availability'];
  size: number;
  mtime_ms: number;
  srt_size: number | null;
  srt_mtime_ms: number | null;
  schema_version: number;
  record_json: string;
}

function decodeClip(row: ClipRow): IndexedClip {
  return {
    key: row.clip_key,
    availability: row.availability,
    fingerprint: {
      size: row.size, mtimeMs: row.mtime_ms,
      srtSize: row.srt_size, srtMtimeMs: row.srt_mtime_ms,
      schemaVersion: row.schema_version,
    },
    record: JSON.parse(row.record_json) as ScanRecord,
  };
}

const SCHEMA = `
  CREATE TABLE archive_revision (revision INTEGER NOT NULL) STRICT;
  INSERT INTO archive_revision VALUES (0);
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
`;

export class ArchiveStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.db.exec('PRAGMA foreign_keys = ON');
      this.transaction('BEGIN IMMEDIATE', () => {
        const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
        if (version === 0) {
          if (this.db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get()) {
            throw new Error('existing database has no archive schema');
          }
          this.db.exec(SCHEMA);
          this.db.exec(`PRAGMA user_version = ${ARCHIVE_SCHEMA_VERSION}`);
        } else if (version !== ARCHIVE_SCHEMA_VERSION) {
          throw new Error(`unsupported archive database schema version: ${String(version)}`);
        }
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  snapshot(): { revision: number; clips: IndexedClip[] } {
    return this.transaction('BEGIN', () => ({
      revision: this.revision(),
      clips: (this.db.prepare('SELECT * FROM clips ORDER BY clip_key').all() as unknown as ClipRow[]).map(decodeClip),
    }));
  }

  listClips(bbox?: Bbox, availability?: IndexedClip['availability']): IndexedClip[] {
    return this.selectClips(bbox, availability, false);
  }

  readTrackCandidates(bbox: Bbox): { clip: IndexedClip; samples: SparseSample[] }[] {
    return this.transaction('BEGIN', () => this.selectClips(bbox, undefined, true).map((clip) => ({
      clip, samples: this.readSamples(clip.key),
    })));
  }

  readOverview(key: string): ScanPoint[][] {
    const row = this.db.prepare('SELECT overview_json FROM clips WHERE clip_key = ?').get(key);
    return row ? JSON.parse(row.overview_json as string) as ScanPoint[][] : [];
  }

  readSamples(key: string): SparseSample[] {
    return this.db.prepare(`
      SELECT segment, lat, lon, t_sec AS tSec FROM clip_samples
      WHERE clip_key = ? ORDER BY segment, sample_index
    `).all(key) as unknown as SparseSample[];
  }

  commit(
    expectedRevision: number, updates: readonly ClipUpdate[],
    online: readonly string[], offline: readonly string[], removed: readonly string[],
  ): void {
    this.transaction('BEGIN IMMEDIATE', () => {
      if (this.revision() !== expectedRevision) {
        throw new Error('archive index changed during scan, rerun the scan');
      }
      for (const update of updates) this.writeClip(update);
      const setAvailability = this.db.prepare('UPDATE clips SET availability = ? WHERE clip_key = ?');
      for (const key of online) setAvailability.run('online', key);
      for (const key of offline) setAvailability.run('offline', key);
      const remove = this.db.prepare('DELETE FROM clips WHERE clip_key = ?');
      for (const key of removed) remove.run(key);
      if (updates.length + online.length + offline.length + removed.length > 0) {
        this.db.exec('UPDATE archive_revision SET revision = revision + 1');
      }
    });
  }

  private revision(): number {
    return this.db.prepare('SELECT revision FROM archive_revision').get()?.revision as number;
  }

  private selectClips(
    bbox: Bbox | undefined, availability: IndexedClip['availability'] | undefined, includeArcs: boolean,
  ): IndexedClip[] {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    if (availability !== undefined) {
      clauses.push('availability = ?');
      values.push(availability);
    }
    if (bbox !== undefined) {
      const ranges = longitudeRanges(bbox);
      const longitude = ranges.map(() => '(min_lon <= ? AND max_lon >= ?)').join(' OR ');
      const latitude = 'min_lat <= ? AND max_lat >= ?';
      if (includeArcs) {
        // An arc's length in degrees is at most the latitude difference plus the
        // longitude span. An excursion beyond either latitude endpoint adds
        // twice its height to that lower bound, so half the span covers it.
        // Wider raw longitude ranges may span the antimeridian or contain a pole-crossing arc.
        clauses.push(`(max_lon - min_lon >= 180 OR (
          min_lat - (max_lon - min_lon) / 2 <= ? AND max_lat + (max_lon - min_lon) / 2 >= ?
          AND (${longitude})
        ))`);
      } else {
        clauses.push(`(${latitude}) AND (${longitude})`);
      }
      values.push(bbox.maxLat, bbox.minLat, ...ranges.flatMap(([west, east]) => [east, west]));
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM clips ${where} ORDER BY clip_key`).all(...values);
    return (rows as unknown as ClipRow[]).map(decodeClip);
  }

  private transaction<T>(begin: 'BEGIN' | 'BEGIN IMMEDIATE', body: () => T): T {
    this.db.exec(begin);
    try {
      const result = body();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private writeClip({ key, availability, fingerprint, record, overview, samples }: ClipUpdate): void {
    const { size, mtimeMs, srtSize, srtMtimeMs, schemaVersion } = fingerprint;
    const bbox = record.bbox;
    this.db.prepare(`
      INSERT INTO clips (
        clip_key, availability, size, mtime_ms, srt_size, srt_mtime_ms, schema_version,
        min_lat, min_lon, max_lat, max_lon, record_json, overview_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (clip_key) DO UPDATE SET
        availability = excluded.availability,
        size = excluded.size, mtime_ms = excluded.mtime_ms,
        srt_size = excluded.srt_size, srt_mtime_ms = excluded.srt_mtime_ms,
        schema_version = excluded.schema_version,
        min_lat = excluded.min_lat, min_lon = excluded.min_lon,
        max_lat = excluded.max_lat, max_lon = excluded.max_lon,
        record_json = excluded.record_json, overview_json = excluded.overview_json
    `).run(
      key, availability, size, mtimeMs, srtSize, srtMtimeMs, schemaVersion,
      bbox?.minLat ?? null, bbox?.minLon ?? null, bbox?.maxLat ?? null, bbox?.maxLon ?? null,
      JSON.stringify(record), JSON.stringify(overview),
    );
    this.db.prepare('DELETE FROM clip_samples WHERE clip_key = ?').run(key);
    const add = this.db.prepare('INSERT INTO clip_samples VALUES (?, ?, ?, ?, ?, ?)');
    for (const [index, sample] of samples.entries()) {
      add.run(key, sample.segment, index, sample.tSec, sample.lat, sample.lon);
    }
  }
}
