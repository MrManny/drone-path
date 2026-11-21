import { decimateTrack } from 'drone-path-core/decimate';
import { haversineM } from 'drone-path-core/geo';
import type { Bbox, LatLon } from 'drone-path-core/geo';
import type { TrackRecord } from 'drone-path-core/track';

export interface ScanPoint extends LatLon {
  tSec: number;
}

export interface SparseSample extends ScanPoint {
  segment: number;
}

export function decimateSegments(segments: readonly ScanPoint[][], maxPoints: number, zoom: number): ScanPoint[][] {
  let minimum = 0;
  let count = 0;
  const retained = segments.filter((points) => {
    const endpoints = Math.min(points.length, 2);
    if (minimum + endpoints > maxPoints) return false;
    minimum += endpoints;
    count += points.length;
    return true;
  });
  const extras = count - minimum;
  const available = Math.min(extras, maxPoints - minimum);
  let allocated = 0;
  let seen = 0;
  return retained.map((points) => {
    const endpoints = Math.min(points.length, 2);
    seen += points.length - endpoints;
    const cumulative = extras === 0 ? 0 : Math.floor(seen * available / extras);
    const budget = endpoints + cumulative - allocated;
    allocated = cumulative;
    if (points.length < 2) return points;
    const reduced = decimateTrack(
      points.map(({ lat }) => lat), points.map(({ lon }) => lon), zoom, { maxPoints: budget },
    );
    return reduced.frame.map((index) => points[index]);
  });
}

export function sampleSegments(segments: readonly ScanPoint[][]): SparseSample[] {
  const samples: SparseSample[] = [];
  for (const [segment, points] of segments.entries()) {
    let second: number | undefined;
    for (const [index, point] of points.entries()) {
      const bucket = Math.floor(point.tSec);
      if (bucket === second && index !== points.length - 1) continue;
      second = bucket;
      samples.push({ ...point, segment });
    }
  }
  return samples;
}

export function summarizeTrack(records: readonly TrackRecord[], onTrack?: (segments: ScanPoint[][]) => void) {
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
  onTrack?.(segments);
  const track = decimateSegments(segments, 500, 18);

  return { track, bbox, fixCount, trackDistanceM };
}
