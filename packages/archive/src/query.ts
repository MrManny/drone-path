import { footprintContains } from 'drone-path-core/ground-footprint';
import type { Bbox, LatLon } from 'drone-path-core/geo';
import { nearestOnTrack, radiusBbox } from 'drone-path-core/spatial';

import { zonedTimeMs } from './camera-time.js';
import { groupFlightMembers } from './flight-members.js';
import { groupSamples } from './scan-track.js';
import type { ScanRecord } from './scanner.js';
import { withArchiveStore } from './store.js';
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

export function matchesMetadata(clip: ScanRecord, { afterMs, beforeMs, minDistanceM }: ListFilters): boolean {
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
  return withArchiveStore(db, (store) =>
    store.listClips(filters.bbox, filters.availability).flatMap((indexed) => {
      const clip = toClip(indexed);
      return matchesMetadata(clip, filters) ? [{ clip, flight: indexed.flight }] : [];
    }),
  );
}

export function listArchive(db: string, filters: ListFilters = {}): ArchiveClip[] {
  return matchingClips(db, filters).map(({ clip }) => clip);
}

export function listArchiveFlights(db: string, filters: ListFilters = {}): ArchiveFlight[] {
  const flights = groupFlightMembers(matchingClips(db, filters));
  return [...flights].map(([flightId, members]) => ({
    flightId, clips: members.map(({ clip, flight }) => ({ ...clip, splitFromKey: flight.splitFromKey })),
  }));
}

export function nearArchive(
  db: string, point: LatLon, radiusM: number = DEFAULT_RADIUS_M, includeGaze = false,
): NearHit[] {
  return withArchiveStore(db, (store) => {
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
  });
}
