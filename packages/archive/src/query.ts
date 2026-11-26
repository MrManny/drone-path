import { footprintContains } from 'drone-path-core/ground-footprint';
import type { Bbox, LatLon } from 'drone-path-core/geo';
import type { KinematicShot, ShotType } from 'drone-path-core/shot-segmentation';
import { nearestOnTrack, radiusBbox } from 'drone-path-core/spatial';

import { zonedTimeMs } from './camera-time.js';
import { groupFlightMembers } from './flight-members.js';
import { groupSamples } from './scan-track.js';
import type { ScanRecord } from './scanner.js';
import { withArchiveStore } from './store.js';
import type { IndexedClip, SegmentFilter } from './store.js';

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
  segmentType?: ShotType;
  minSmoothness?: number;
}

export interface ArchiveSegment extends KinematicShot {
  clip: ArchiveClip;
}

export interface NearHit {
  clip: ArchiveClip;
  tSec: number;
  distanceM: number;
  matchType: 'track' | 'gaze';
}

export function segmentFilterOf({ segmentType, minSmoothness }: ListFilters): SegmentFilter | undefined {
  if (minSmoothness !== undefined && (!Number.isFinite(minSmoothness) || minSmoothness < 0 || minSmoothness > 1)) {
    throw new Error('expected a smoothness score between 0 and 1');
  }
  if (segmentType === undefined && minSmoothness === undefined) return undefined;
  return { segmentType, minSmoothness };
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

function matchingClips(db: string, filters: ListFilters, overview = false) {
  const segmentFilter = segmentFilterOf(filters);
  return withArchiveStore(db, (store) => {
    const clips = overview
      ? store.listClipOverviews(filters.bbox, filters.availability, segmentFilter)
      : store.listClips(filters.bbox, filters.availability, segmentFilter);
    return clips.flatMap((indexed) => {
      const clip = toClip(indexed);
      return matchesMetadata(clip, filters) ? [{ clip, flight: indexed.flight }] : [];
    });
  });
}

export function listArchive(db: string, filters: ListFilters = {}): ArchiveClip[] {
  return matchingClips(db, filters).map(({ clip }) => clip);
}

export function listArchiveFlights(
  db: string,
  filters: ListFilters = {},
  options: { overview?: boolean } = {},
): ArchiveFlight[] {
  const flights = groupFlightMembers(matchingClips(db, filters, options.overview === true));
  return [...flights].map(([flightId, members]) => ({
    flightId, clips: members.map(({ clip, flight }) => ({ ...clip, splitFromKey: flight.splitFromKey })),
  }));
}

export function listArchiveFlightOverviews(db: string, filters: ListFilters = {}): ArchiveFlight[] {
  return listArchiveFlights(db, filters, { overview: true });
}

export function listArchiveSegments(db: string, filters: ListFilters = {}): ArchiveSegment[] {
  const segmentFilter = segmentFilterOf(filters);
  return withArchiveStore(db, (store) =>
    store.listSegments({
      bbox: filters.bbox,
      availability: filters.availability,
      segmentType: segmentFilter?.segmentType,
      minSmoothness: segmentFilter?.minSmoothness,
    }).flatMap(({ clip: indexed, segment }) => {
      const clip = toClip(indexed);
      return matchesMetadata(clip, filters) ? [{ clip, ...segment }] : [];
    }),
  );
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

export function pruneArchiveOffline(db: string): number {
  return withArchiveStore(db, (store) => store.pruneOffline());
}
