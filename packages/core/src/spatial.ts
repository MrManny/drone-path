import { EARTH_RADIUS_M } from './geo.js';
import type { Bbox, LatLon } from './geo.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const ANGLE_EPSILON = 1e-12;

export interface TimedPoint extends LatLon {
  tSec: number;
}

export interface ClosestApproach {
  tSec: number;
  distanceM: number;
}

type Vector = readonly [number, number, number];
type LongitudeRange = readonly [number, number];

export function longitudeRanges({ minLon, maxLon }: Bbox): LongitudeRange[] {
  if (minLon > maxLon) return [[minLon, 180], [-180, maxLon]];
  if (minLon === -180 && maxLon === 180) return [[minLon, maxLon]];
  if (minLon === -180) return [[minLon, maxLon], [180, 180]];
  if (maxLon === 180) return [[minLon, maxLon], [-180, -180]];
  return [[minLon, maxLon]];
}

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  if (a.maxLat < b.minLat || b.maxLat < a.minLat) return false;
  const ranges = longitudeRanges(b);
  return longitudeRanges(a).some(([west, east]) =>
    ranges.some(([otherWest, otherEast]) => west <= otherEast && otherWest <= east),
  );
}

export function resolveTrackBbox(bbox: Bbox, segments: readonly (readonly LatLon[])[]): Bbox {
  if (bbox.maxLon - bbox.minLon <= 180) return bbox;

  // Archived extrema still describe real fixes even if decimation dropped them.
  const ranges: LongitudeRange[] = [[bbox.minLon, bbox.minLon], [bbox.maxLon, bbox.maxLon]];
  let crossesAntimeridian = false;
  for (const segment of segments) {
    if (segment.length === 1) ranges.push([segment[0].lon, segment[0].lon]);
    for (let i = 1; i < segment.length; i++) {
      const west = Math.min(segment[i - 1].lon, segment[i].lon);
      const east = Math.max(segment[i - 1].lon, segment[i].lon);
      if (east - west === 180) return { ...bbox, minLon: -180, maxLon: 180 };
      if (east - west > 180) {
        crossesAntimeridian = true;
        ranges.push([-180, west], [east, 180]);
      } else {
        ranges.push([west, east]);
      }
    }
  }
  if (!crossesAntimeridian) return bbox;

  // Leave out only the largest uncovered interval. Every indexed arc and
  // recorded extremum stays inside the resulting circular bounding box.
  ranges.sort(([westA], [westB]) => westA - westB);
  let end = -180;
  let largestGap = 0;
  let minLon = -180;
  let maxLon = 180;
  for (const [west, east] of ranges) {
    if (west - end > largestGap) {
      largestGap = west - end;
      minLon = west;
      maxLon = end;
    }
    end = Math.max(end, east);
  }
  return { ...bbox, minLon, maxLon };
}

function wrapLongitude(lon: number): number {
  if (lon < -180) return lon + 360;
  if (lon > 180) return lon - 360;
  return lon;
}

export function radiusBbox(center: LatLon, radiusM: number): Bbox {
  // Round outward so a hit on the radius boundary survives the SQL prefilter.
  const angle = radiusM / EARTH_RADIUS_M + ANGLE_EPSILON;
  const degrees = angle * RAD_TO_DEG;
  const minLat = Math.max(-90, center.lat - degrees);
  const maxLat = Math.min(90, center.lat + degrees);
  if (minLat === -90 || maxLat === 90) return { minLat, maxLat, minLon: -180, maxLon: 180 };

  const longitudeDelta = Math.asin(Math.min(1, Math.sin(angle) / Math.cos(center.lat * DEG_TO_RAD))) * RAD_TO_DEG;
  return {
    minLat, maxLat,
    minLon: wrapLongitude(center.lon - longitudeDelta),
    maxLon: wrapLongitude(center.lon + longitudeDelta),
  };
}

function unitVector({ lat, lon }: LatLon): Vector {
  if (Math.abs(lat) === 90) return [0, 0, Math.sign(lat)];
  const phi = lat * DEG_TO_RAD;
  const lambda = (lon === 180 ? -180 : lon) * DEG_TO_RAD;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector, b: Vector): Vector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function distanceM(a: Vector, b: Vector): number {
  return EARTH_RADIUS_M * Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
}

function projectOntoArc(
  query: Vector, start: Vector, end: Vector, startTime: number, endTime: number,
): ClosestApproach | null {
  const normal = cross(start, end);
  const sine = Math.hypot(...normal);
  // Coincident fixes and antipodal endpoints do not define a unique great circle.
  if (sine <= Number.EPSILON) return null;
  const arc = Math.atan2(sine, dot(start, end));
  const tangent = cross(normal, start);
  const angle = Math.atan2(dot(query, tangent) / sine, dot(query, start));
  if (angle <= 0 || angle >= arc) return null;

  const alongStart = Math.cos(angle);
  const alongTangent = Math.sin(angle) / sine;
  const offset = (index: 0 | 1 | 2) => start[index] * alongStart + tangent[index] * alongTangent;
  return {
    tSec: startTime + (endTime - startTime) * angle / arc,
    distanceM: distanceM(query, [offset(0), offset(1), offset(2)]),
  };
}

export function nearestOnTrack(query: LatLon, segments: readonly (readonly TimedPoint[])[]): ClosestApproach | null {
  const target = unitVector(query);
  let best: ClosestApproach | null = null;
  function consider(candidate: ClosestApproach): void {
    if (best === null || candidate.distanceM < best.distanceM ||
        (candidate.distanceM === best.distanceM && candidate.tSec < best.tSec)) {
      best = candidate;
    }
  }

  for (const segment of segments) {
    let previous: { vector: Vector; tSec: number } | undefined;
    for (const point of segment) {
      const vector = unitVector(point);
      consider({ distanceM: distanceM(target, vector), tSec: point.tSec });
      if (previous) {
        const interior = projectOntoArc(target, previous.vector, vector, previous.tSec, point.tSec);
        if (interior) consider(interior);
      }
      previous = { vector, tSec: point.tSec };
    }
  }
  return best;
}
