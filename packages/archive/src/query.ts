import type { Bbox, LatLon } from 'drone-path-core/geo';
import { nearestOnTrack, radiusBbox } from 'drone-path-core/spatial';

import { groupSamples } from './scan-track.js';
import type { ScanRecord } from './scanner.js';
import { ArchiveStore } from './store.js';
import type { IndexedClip } from './store.js';

export const DEFAULT_RADIUS_M = 100;
export type ArchiveAvailability = IndexedClip['availability'];
export type ArchiveClip = ScanRecord & { availability: ArchiveAvailability };

export interface ListFilters {
  bbox?: Bbox;
  afterMs?: number;
  beforeMs?: number;
  minDistanceM?: number;
  availability?: ArchiveAvailability;
}

export interface NearHit {
  clip: ArchiveClip;
  tSec: number;
  distanceM: number;
  matchType: 'track';
}

const ISO_ZONED_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/u;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;

function validCalendarDay(day: string): boolean {
  const epoch = Date.parse(day);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === day;
}

function zonedTimeMs(time: string): number {
  const day = ISO_ZONED_TIME.exec(time)?.[1];
  return day && validCalendarDay(day) ? Date.parse(time) : NaN;
}

export function parseDateBound(time: string): number {
  const epoch = ISO_DAY.test(time) && validCalendarDay(time) ? Date.parse(time) : zonedTimeMs(time);
  if (!Number.isFinite(epoch)) throw new Error('expected an ISO date or timestamp with a time zone');
  return epoch;
}

function matchesMetadata(clip: ArchiveClip, { afterMs, beforeMs, minDistanceM }: ListFilters): boolean {
  if (minDistanceM !== undefined &&
      (clip.telemetry === null || clip.telemetry.trackDistanceM < minDistanceM)) return false;
  if (afterMs === undefined && beforeMs === undefined) return true;
  const time = clip.cameraCreationTime === null ? NaN : zonedTimeMs(clip.cameraCreationTime);
  return Number.isFinite(time) &&
    (afterMs === undefined || time >= afterMs) &&
    (beforeMs === undefined || time < beforeMs);
}

function toClip({ record, availability }: IndexedClip): ArchiveClip {
  return { ...record, availability };
}

export function listArchive(db: string, filters: ListFilters = {}): ArchiveClip[] {
  const store = new ArchiveStore(db);
  try {
    return store.listClips(filters.bbox, filters.availability).map(toClip)
      .filter((clip) => matchesMetadata(clip, filters));
  } finally {
    store.close();
  }
}

export function nearArchive(db: string, point: LatLon, radiusM: number = DEFAULT_RADIUS_M): NearHit[] {
  const store = new ArchiveStore(db);
  try {
    const hits: NearHit[] = [];
    for (const { clip, samples } of store.readTrackCandidates(radiusBbox(point, radiusM))) {
      const match = nearestOnTrack(point, groupSamples(samples));
      if (match !== null && match.distanceM <= radiusM) {
        hits.push({ clip: toClip(clip), ...match, matchType: 'track' });
      }
    }
    // Stable sorting preserves clip-key order for equal distances.
    return hits.sort((a, b) => a.distanceM - b.distanceM);
  } finally {
    store.close();
  }
}
