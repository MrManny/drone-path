import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

import { groupFlights } from 'drone-path-core/flight-grouping';
import type { FlightMembership } from 'drone-path-core/flight-grouping';
import type { Bbox, LatLon } from 'drone-path-core/geo';
import type { KinematicShot, ShotType } from 'drone-path-core/shot-segmentation';
import { bboxIntersects, longitudeRanges, resolveTrackBbox } from 'drone-path-core/spatial';

import { zonedTimeMs } from './camera-time.js';
import { gazeBbox } from './gaze.js';
import type { GazeSample } from './gaze.js';
import { groupSamples } from './scan-track.js';
import type { ScanPoint, SparseSample } from './scan-track.js';
import type { ScanRecord } from './scanner.js';

export const ARCHIVE_SCHEMA_VERSION = 4;
export const CLIP_FINGERPRINT_VERSION = 1;

export interface SegmentFilter {
  segmentType?: ShotType;
  minSmoothness?: number;
}

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
  gaze?: GazeSample[];
  segments?: KinematicShot[];
}

export interface IndexedFlightClip extends IndexedClip {
  flight: FlightMembership;
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

interface FlightClipRow extends ClipRow {
  flight_id: string;
  flight_order: number;
  split_from_key: string | null;
}

interface SegmentRow {
  segment_type: ShotType;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  smoothness: number;
  exposure_stable: number;
  mean_speed_mps: number;
  mean_yaw_rate_deg_per_sec: number;
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

function decodeFlightClip(row: FlightClipRow): IndexedFlightClip {
  return {
    ...decodeClip(row),
    flight: {
      key: row.clip_key, flightId: row.flight_id, order: row.flight_order, splitFromKey: row.split_from_key,
    },
  };
}

function decodeSegment(row: SegmentRow): KinematicShot {
  return {
    type: row.segment_type,
    startSec: row.start_sec,
    endSec: row.end_sec,
    durationSec: row.duration_sec,
    smoothness: row.smoothness,
    exposureStable: row.exposure_stable === 1,
    meanSpeedMps: row.mean_speed_mps,
    meanYawRateDegPerSec: row.mean_yaw_rate_deg_per_sec,
  };
}

function normalizeForCompare(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(root: string, filePath: string): boolean {
  const rel = path.relative(normalizeForCompare(root), normalizeForCompare(filePath));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
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
    overview_json TEXT NOT NULL,
    segments_indexed INTEGER NOT NULL DEFAULT 0
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

const FLIGHT_SCHEMA = `
  CREATE TABLE clip_flights (
    clip_key TEXT PRIMARY KEY REFERENCES clips (clip_key) ON DELETE CASCADE,
    flight_id TEXT NOT NULL,
    flight_order INTEGER NOT NULL,
    split_from_key TEXT REFERENCES clips (clip_key) ON DELETE SET NULL
  ) STRICT;
`;

const GAZE_SCHEMA = `
  CREATE TABLE clip_gaze (
    clip_key TEXT PRIMARY KEY REFERENCES clips (clip_key) ON DELETE CASCADE,
    min_lat REAL,
    max_lat REAL,
    min_lon REAL,
    max_lon REAL,
    samples_json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX clip_gaze_bbox ON clip_gaze (min_lat, max_lat, min_lon, max_lon);
`;

const SEGMENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS segments (
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
  CREATE INDEX IF NOT EXISTS segments_type_smoothness ON segments (segment_type, smoothness DESC);
`;

export class ArchiveStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.db.exec('PRAGMA foreign_keys = ON');
      if (this.schemaVersion() !== ARCHIVE_SCHEMA_VERSION) this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private schemaVersion() {
    return this.db.prepare('PRAGMA user_version').get()?.user_version;
  }

  private migrate(): void {
    this.transaction('BEGIN IMMEDIATE', () => {
      const version = this.schemaVersion();
      if (version === ARCHIVE_SCHEMA_VERSION) return;
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > ARCHIVE_SCHEMA_VERSION) {
        throw new Error(`unsupported archive database schema version: ${String(version)}`);
      }
      if (version === 0) {
        if (this.db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get()) {
          throw new Error('existing database has no archive schema');
        }
        this.db.exec(SCHEMA);
      }
      if (version < 2) {
        this.db.exec(FLIGHT_SCHEMA);
        if (version === 1) this.refreshFlights();
      }
      if (version < 3) {
        this.db.exec(GAZE_SCHEMA);
      }
      if (version < 4) {
        const columns = this.db.prepare('PRAGMA table_info(clips)').all() as { name: string }[];
        if (!columns.some((col) => col.name === 'segments_indexed')) {
          this.db.exec('ALTER TABLE clips ADD COLUMN segments_indexed INTEGER NOT NULL DEFAULT 0');
        }
        this.db.exec(SEGMENTS_SCHEMA);
      }
      this.db.exec(`PRAGMA user_version = ${ARCHIVE_SCHEMA_VERSION}`);
    });
  }

  close(): void {
    this.db.close();
  }

  snapshot(): { revision: number; clips: (IndexedClip & { gazePending: boolean; segmentsPending: boolean })[] } {
    return this.transaction('BEGIN', () => ({
      revision: this.revision(),
      clips: (this.db.prepare(`
        SELECT clips.*,
          clip_gaze.clip_key IS NULL AND
            json_extract(record_json, '$.telemetry.method') IS 'dvtm-packets' AS gaze_pending,
          segments_indexed = 0 AND
            json_extract(record_json, '$.status') IS 'ok' AS segments_pending
        FROM clips LEFT JOIN clip_gaze USING (clip_key) ORDER BY clip_key
      `).all() as unknown as (ClipRow & { gaze_pending: number; segments_pending: number })[]).map((row) => ({
        ...decodeClip(row),
        gazePending: row.gaze_pending === 1,
        segmentsPending: row.segments_pending === 1,
      })),
    }));
  }

  listClips(
    bbox?: Bbox,
    availability?: IndexedClip['availability'],
    segmentFilter?: SegmentFilter,
  ): IndexedFlightClip[] {
    if (bbox === undefined) return this.selectClips(undefined, availability, false, segmentFilter);
    return this.transaction('BEGIN', () => this.selectClipViewport(bbox, availability, segmentFilter));
  }

  private clipMatchesViewport(bbox: Bbox, key: string, record: ScanRecord): boolean {
    const raw = record.bbox;
    if (raw === null) return false;
    if (raw.maxLon - raw.minLon <= 180) return true;
    return bboxIntersects(bbox, resolveTrackBbox(raw, [...record.track, ...groupSamples(this.readSamples(key))]));
  }

  private selectClipViewport(
    bbox?: Bbox,
    availability?: IndexedClip['availability'],
    segmentFilter?: SegmentFilter,
  ): IndexedFlightClip[] {
    const clips = this.selectClips(bbox, availability, false, segmentFilter);
    if (bbox === undefined) return clips;
    return clips.filter(({ key, record }) => this.clipMatchesViewport(bbox, key, record));
  }

  readExportCandidates(
    bbox: Bbox | undefined, availability: IndexedClip['availability'] | undefined,
    matches: (clip: IndexedClip) => boolean, options: { includeGaze: boolean; redact: boolean },
    segmentFilter?: SegmentFilter,
  ) {
    return this.transaction('BEGIN', () => {
      const clips = this.selectClipViewport(bbox, availability, segmentFilter).filter(matches);
      const endpoints = options.redact ? this.readLaunchEndpoints(new Set(clips.map(({ flight }) => flight.flightId))) : [];
      const gaze = options.includeGaze ? this.db.prepare('SELECT samples_json FROM clip_gaze WHERE clip_key = ?') : undefined;
      return {
        endpoints,
        clips: clips.map((clip) => ({
          ...clip,
          gaze: JSON.parse(gaze?.get(clip.key)?.samples_json as string ?? '[]') as GazeSample[],
        })),
      };
    });
  }

  private readLaunchEndpoints(flightIds: ReadonlySet<string>): LatLon[] {
    const endpoints: LatLon[] = [];
    for (const direction of ['ASC', 'DESC']) {
      const statement = this.db.prepare(`
        SELECT lat, lon FROM clip_flights JOIN clip_samples USING (clip_key)
        WHERE flight_id = ?
        ORDER BY flight_order ${direction}, segment ${direction}, sample_index ${direction} LIMIT 1
      `);
      for (const id of flightIds) {
        const point = statement.get(id) as unknown as LatLon | undefined;
        if (point) endpoints.push(point);
      }
    }
    return endpoints;
  }

  readTrackCandidates(bbox: Bbox): { clip: IndexedClip; samples: SparseSample[] }[] {
    return this.readNearCandidates(bbox).tracks;
  }

  readNearCandidates(bbox: Bbox, point?: LatLon) {
    return this.transaction('BEGIN', () => ({
      tracks: this.selectClips(bbox, undefined, true).map((clip) => ({ clip, samples: this.readSamples(clip.key) })),
      gaze: point ? this.selectGazeCandidates(point) : [],
    }));
  }

  private selectGazeCandidates({ lat, lon }: LatLon): { clip: IndexedClip; samples: GazeSample[] }[] {
    const longitude = lon === 180 ? -180 : lon;
    const rows = this.db.prepare(`
      SELECT clips.*, samples_json FROM clips JOIN clip_gaze USING (clip_key)
      WHERE clip_gaze.min_lat <= ? AND clip_gaze.max_lat >= ?
        AND clip_gaze.min_lon <= ? AND clip_gaze.max_lon >= ?
      ORDER BY clip_key
    `).all(lat, lat, longitude, longitude) as unknown as (ClipRow & { samples_json: string })[];
    return rows.map((row) => ({ clip: decodeClip(row), samples: JSON.parse(row.samples_json) as GazeSample[] }));
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

  readSegments(key: string): KinematicShot[] {
    const rows = this.db.prepare(`
      SELECT segment_type, start_sec, end_sec, duration_sec, smoothness,
        exposure_stable, mean_speed_mps, mean_yaw_rate_deg_per_sec
      FROM segments WHERE clip_key = ? ORDER BY segment_index
    `).all(key) as unknown as SegmentRow[];
    return rows.map(decodeSegment);
  }

  listSegments(filters: {
    bbox?: Bbox;
    availability?: IndexedClip['availability'];
    segmentType?: ShotType;
    minSmoothness?: number;
  } = {}): { clip: IndexedClip; segment: KinematicShot }[] {
    return this.transaction('BEGIN', () => {
      const { clauses, values } = this.clipFilterClauses(filters.bbox, filters.availability, false);
      if (filters.segmentType !== undefined) {
        clauses.push('segments.segment_type = ?');
        values.push(filters.segmentType);
      }
      if (filters.minSmoothness !== undefined) {
        clauses.push('segments.smoothness >= ?');
        values.push(filters.minSmoothness);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = this.db.prepare(`
        SELECT clips.*, segments.segment_type, segments.start_sec, segments.end_sec,
          segments.duration_sec, segments.smoothness, segments.exposure_stable,
          segments.mean_speed_mps, segments.mean_yaw_rate_deg_per_sec
        FROM segments JOIN clips USING (clip_key)
        ${where}
        ORDER BY segments.smoothness DESC, segments.clip_key ASC, segments.start_sec ASC
      `).all(...values) as unknown as (ClipRow & SegmentRow)[];

      const viewportCache = new Map<string, boolean>();
      const results: { clip: IndexedClip; segment: KinematicShot }[] = [];
      for (const row of rows) {
        const clip = decodeClip(row);
        if (filters.bbox !== undefined) {
          let matches = viewportCache.get(clip.key);
          if (matches === undefined) {
            matches = this.clipMatchesViewport(filters.bbox, clip.key, clip.record);
            viewportCache.set(clip.key, matches);
          }
          if (!matches) continue;
        }
        results.push({ clip, segment: decodeSegment(row) });
      }
      return results;
    });
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
      if (updates.length + removed.length > 0) this.refreshFlights();
      if (updates.length + online.length + offline.length + removed.length > 0) {
        this.db.exec('UPDATE archive_revision SET revision = revision + 1');
      }
    });
  }

  removeClipsUnder(root: string): number {
    return this.transaction('BEGIN IMMEDIATE', () => {
      const rows = this.db.prepare(`
        SELECT clip_key, json_extract(record_json, '$.path') AS clip_path FROM clips
      `).all() as { clip_key: string; clip_path: string | null }[];
      const matched = rows
        .filter((row) => typeof row.clip_path === 'string' && isWithinRoot(root, row.clip_path))
        .map((row) => row.clip_key);
      if (matched.length === 0) return 0;
      const remove = this.db.prepare('DELETE FROM clips WHERE clip_key = ?');
      for (const key of matched) remove.run(key);
      this.refreshFlights();
      this.db.exec('UPDATE archive_revision SET revision = revision + 1');
      return matched.length;
    });
  }

  private revision(): number {
    return this.db.prepare('SELECT revision FROM archive_revision').get()?.revision as number;
  }

  private clipFilterClauses(
    bbox: Bbox | undefined,
    availability: IndexedClip['availability'] | undefined,
    includeArcs: boolean,
    segmentFilter?: SegmentFilter,
  ): { clauses: string[]; values: SQLInputValue[] } {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    if (availability !== undefined) {
      clauses.push('clips.availability = ?');
      values.push(availability);
    }
    if (bbox !== undefined) {
      const ranges = longitudeRanges(bbox);
      const longitude = ranges.map(() => '(clips.min_lon <= ? AND clips.max_lon >= ?)').join(' OR ');
      const latitude = 'clips.min_lat <= ? AND clips.max_lat >= ?';
      if (includeArcs) {
        // An arc's length in degrees is at most the latitude difference plus the
        // longitude span. An excursion beyond either latitude endpoint adds
        // twice its height to that lower bound, so half the span covers it.
        // Wider raw longitude ranges may span the antimeridian or contain a pole-crossing arc.
        clauses.push(`(clips.max_lon - clips.min_lon >= 180 OR (
          clips.min_lat - (clips.max_lon - clips.min_lon) / 2 <= ? AND clips.max_lat + (clips.max_lon - clips.min_lon) / 2 >= ?
          AND (${longitude})
        ))`);
      } else {
        clauses.push(`(${latitude}) AND (clips.max_lon - clips.min_lon > 180 OR (${longitude}))`);
      }
      values.push(bbox.maxLat, bbox.minLat, ...ranges.flatMap(([west, east]) => [east, west]));
    }
    if (segmentFilter?.segmentType !== undefined || segmentFilter?.minSmoothness !== undefined) {
      const segClauses: string[] = ['segments.clip_key = clips.clip_key'];
      if (segmentFilter.segmentType !== undefined) {
        segClauses.push('segments.segment_type = ?');
        values.push(segmentFilter.segmentType);
      }
      if (segmentFilter.minSmoothness !== undefined) {
        segClauses.push('segments.smoothness >= ?');
        values.push(segmentFilter.minSmoothness);
      }
      clauses.push(`EXISTS (SELECT 1 FROM segments WHERE ${segClauses.join(' AND ')})`);
    }
    return { clauses, values };
  }

  private selectClips(
    bbox: Bbox | undefined, availability: IndexedClip['availability'] | undefined, includeArcs: boolean,
    segmentFilter?: SegmentFilter,
  ): IndexedFlightClip[] {
    const { clauses, values } = this.clipFilterClauses(bbox, availability, includeArcs, segmentFilter);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM clips JOIN clip_flights USING (clip_key) ${where} ORDER BY clip_key
    `).all(...values);
    return (rows as unknown as FlightClipRow[]).map(decodeFlightClip);
  }

  private refreshFlights(): void {
    const rows = this.db.prepare(`
      SELECT clip_key, size, json_extract(record_json, '$.cameraCreationTime') AS camera_time,
        json_extract(record_json, '$.video.durationSec') AS duration_sec
      FROM clips ORDER BY clip_key
    `).all() as { clip_key: string; size: number; camera_time: string | null; duration_sec: number | null }[];
    const first = this.db.prepare(`
      SELECT lat, lon, t_sec AS tSec FROM clip_samples
      WHERE clip_key = ? ORDER BY segment, sample_index LIMIT 1
    `);
    const last = this.db.prepare(`
      SELECT lat, lon, t_sec AS tSec FROM clip_samples
      WHERE clip_key = ? ORDER BY segment DESC, sample_index DESC LIMIT 1
    `);
    const memberships = groupFlights(rows.map(({ clip_key, size, camera_time, duration_sec }) => ({
      key: clip_key, size, startMs: camera_time === null ? null : zonedTimeMs(camera_time),
      durationSec: duration_sec,
      firstFix: first.get(clip_key) as unknown as ScanPoint | undefined,
      lastFix: last.get(clip_key) as unknown as ScanPoint | undefined,
    })));
    this.db.exec('DELETE FROM clip_flights');
    const add = this.db.prepare('INSERT INTO clip_flights VALUES (?, ?, ?, ?)');
    for (const { key, flightId, order, splitFromKey } of memberships) add.run(key, flightId, order, splitFromKey);
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

  private writeClip({ key, availability, fingerprint, record, overview, samples, gaze, segments }: ClipUpdate): void {
    const { size, mtimeMs, srtSize, srtMtimeMs, schemaVersion } = fingerprint;
    const bbox = record.bbox;
    const segmentsIndexed = segments !== undefined ? 1 : 0;
    this.db.prepare(`
      INSERT INTO clips (
        clip_key, availability, size, mtime_ms, srt_size, srt_mtime_ms, schema_version,
        min_lat, min_lon, max_lat, max_lon, record_json, overview_json, segments_indexed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (clip_key) DO UPDATE SET
        availability = excluded.availability,
        size = excluded.size, mtime_ms = excluded.mtime_ms,
        srt_size = excluded.srt_size, srt_mtime_ms = excluded.srt_mtime_ms,
        schema_version = excluded.schema_version,
        min_lat = excluded.min_lat, min_lon = excluded.min_lon,
        max_lat = excluded.max_lat, max_lon = excluded.max_lon,
        record_json = excluded.record_json, overview_json = excluded.overview_json,
        segments_indexed = excluded.segments_indexed
    `).run(
      key, availability, size, mtimeMs, srtSize, srtMtimeMs, schemaVersion,
      bbox?.minLat ?? null, bbox?.minLon ?? null, bbox?.maxLat ?? null, bbox?.maxLon ?? null,
      JSON.stringify(record), JSON.stringify(overview), segmentsIndexed,
    );
    this.db.prepare('DELETE FROM clip_samples WHERE clip_key = ?').run(key);
    this.writeGaze(key, gaze);
    this.writeSegments(key, segments);
    const add = this.db.prepare('INSERT INTO clip_samples VALUES (?, ?, ?, ?, ?, ?)');
    for (const [index, sample] of samples.entries()) {
      add.run(key, sample.segment, index, sample.tSec, sample.lat, sample.lon);
    }
  }

  private writeGaze(key: string, gaze: GazeSample[] | undefined): void {
    this.db.prepare('DELETE FROM clip_gaze WHERE clip_key = ?').run(key);
    if (!gaze) return;
    const bbox = gazeBbox(gaze);
    this.db.prepare('INSERT INTO clip_gaze VALUES (?, ?, ?, ?, ?, ?)').run(
      key, bbox?.minLat ?? null, bbox?.maxLat ?? null, bbox?.minLon ?? null, bbox?.maxLon ?? null,
      JSON.stringify(gaze),
    );
  }

  private writeSegments(key: string, segments: readonly KinematicShot[] | undefined): void {
    this.db.prepare('DELETE FROM segments WHERE clip_key = ?').run(key);
    if (!segments) return;
    const add = this.db.prepare(`
      INSERT INTO segments (
        clip_key, segment_index, segment_type, start_sec, end_sec, duration_sec,
        smoothness, exposure_stable, mean_speed_mps, mean_yaw_rate_deg_per_sec
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [index, segment] of segments.entries()) {
      add.run(
        key, index, segment.type, segment.startSec, segment.endSec, segment.durationSec,
        segment.smoothness, segment.exposureStable ? 1 : 0,
        segment.meanSpeedMps, segment.meanYawRateDegPerSec,
      );
    }
  }
}

export function withArchiveStore<T>(db: string, run: (store: ArchiveStore) => T): T {
  const store = new ArchiveStore(db);
  try {
    return run(store);
  } finally {
    store.close();
  }
}

export async function withArchiveStoreAsync<T>(db: string, run: (store: ArchiveStore) => Promise<T>): Promise<T> {
  const store = new ArchiveStore(db);
  try {
    return await run(store);
  } finally {
    store.close();
  }
}
