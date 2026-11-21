import { footprintContains } from 'drone-path-core/ground-footprint';
import type { Bbox, LatLon } from 'drone-path-core/geo';
import { nearestOnTrack, radiusBbox } from 'drone-path-core/spatial';

import { zonedTimeMs } from './camera-time.js';
import { groupSamples } from './scan-track.js';
import type { ScanRecord } from './scanner.js';
import { ArchiveStore } from './store.js';
import type { IndexedClip } from './store.js';

export { parseDateBound } from './camera-time.js';

export const DEFAULT_RADIUS_M = 100;
export type ArchiveAvailability = IndexedClip['availability'];
export type ArchiveClip = ScanRecord & { availability: ArchiveAvailability };
export type FlightListClip = ArchiveClip & { splitFromKey: string | null };

export interface ArchiveFlight {
  flightId: string;
  clips: FlightListClip[];
}

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
  matchType: 'track' | 'gaze';
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

function matchingClips(db: string, filters: ListFilters) {
  const store = new ArchiveStore(db);
  try {
    return store.listClips(filters.bbox, filters.availability).flatMap((indexed) => {
      const clip = toClip(indexed);
      return matchesMetadata(clip, filters) ? [{ clip, flight: indexed.flight }] : [];
    });
  } finally {
    store.close();
  }
}

export function listArchive(db: string, filters: ListFilters = {}): ArchiveClip[] {
  return matchingClips(db, filters).map(({ clip }) => clip);
}

export function listArchiveFlights(db: string, filters: ListFilters = {}): ArchiveFlight[] {
  const flights = new Map<string, { order: number; clip: FlightListClip }[]>();
  for (const { clip, flight } of matchingClips(db, filters)) {
    const member = { order: flight.order, clip: { ...clip, splitFromKey: flight.splitFromKey } };
    const members = flights.get(flight.flightId);
    if (members) members.push(member);
    else flights.set(flight.flightId, [member]);
  }
  return [...flights].map(([flightId, members]) => ({
    flightId, clips: members.sort((a, b) => a.order - b.order).map(({ clip }) => clip),
  }));
}

export function nearArchive(
  db: string, point: LatLon, radiusM: number = DEFAULT_RADIUS_M, includeGaze = false,
): NearHit[] {
  const store = new ArchiveStore(db);
  try {
    const hits: NearHit[] = [];
    const { tracks, gaze } = store.readNearCandidates(radiusBbox(point, radiusM), includeGaze ? point : undefined);
    for (const { clip, samples } of tracks) {
      const match = nearestOnTrack(point, groupSamples(samples));
      if (match !== null && match.distanceM <= radiusM) {
        hits.push({ clip: toClip(clip), ...match, matchType: 'track' });
      }
    }
    for (const { clip, samples } of gaze) {
      const match = samples.find(({ polygon }) => footprintContains(polygon, point));
      if (match) hits.push({ clip: toClip(clip), tSec: match.tSec, distanceM: 0, matchType: 'gaze' });
    }
    // Stable sorting preserves clip-key order within each match type for equal distances.
    return hits.sort((a, b) => a.distanceM - b.distanceM);
  } finally {
    store.close();
  }
}
