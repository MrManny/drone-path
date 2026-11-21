import { decimateTrack } from 'drone-path-core/decimate';
import { haversineM } from 'drone-path-core/geo';
import type { Bbox, LatLon } from 'drone-path-core/geo';
import type { TrackRecord } from 'drone-path-core/track';

export interface ScanPoint extends LatLon {
  tSec: number;
}

export function summarizeTrack(records: readonly TrackRecord[]) {
  const segments: ScanPoint[][] = [];
  let segment: ScanPoint[] = [];
  let bbox: Bbox | null = null;
  let trackDistanceM = 0;
  let fixCount = 0;

  for (const { lat, lng, tSec } of records) {
    if (lat === null || lat === undefined || lng === null || lng === undefined || !Number.isFinite(tSec)) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
      continue;
    }

    const point = { lat, lon: lng, tSec };
    const previous = segment.at(-1);
    if (previous) trackDistanceM += haversineM(previous, point);
    segment.push(point);
    fixCount++;

    bbox ??= { minLat: lat, maxLat: lat, minLon: lng, maxLon: lng };
    bbox.minLat = Math.min(bbox.minLat, lat);
    bbox.maxLat = Math.max(bbox.maxLat, lat);
    bbox.minLon = Math.min(bbox.minLon, lng);
    bbox.maxLon = Math.max(bbox.maxLon, lng);
  }

  if (segment.length > 0) segments.push(segment);
  const track = segments.map((points) => {
    const reduced = decimateTrack(
      points.map(({ lat }) => lat),
      points.map(({ lon }) => lon),
      18,
      { maxPoints: 500 },
    );
    return reduced.frame.map((index) => points[index]);
  });

  return { track, bbox, fixCount, trackDistanceM };
}
