import { haversineM } from './geo.js';
import type { Bbox, LatLon } from './geo.js';
import { bboxIntersects, nearestOnTrack, radiusBbox } from './spatial.js';

function projectedEdgeIntersects(start: LatLon, end: LatLon, zone: Bbox): boolean {
  const bounds = {
    minLat: Math.min(start.lat, end.lat), maxLat: Math.max(start.lat, end.lat),
    minLon: Math.min(start.lon, end.lon), maxLon: Math.max(start.lon, end.lon),
  };
  return bboxIntersects(zone, bounds) || (bounds.maxLon - bounds.minLon >= 180 &&
    bboxIntersects(zone, { ...bounds, minLon: bounds.maxLon, maxLon: bounds.minLon }));
}

export function launchRedactor(endpoints: readonly LatLon[], radiusM: number) {
  const zones = radiusM > 0 ? endpoints.map((center) => ({ center, bbox: radiusBbox(center, radiusM) })) : [];
  return function redact<T extends LatLon>(segments: readonly (readonly T[])[]): T[][] {
    const kept: T[][] = [];
    for (const segment of segments) {
      let run: T[] = [];
      const endRun = () => {
        if (run.length > 0) kept.push(run);
        run = [];
      };
      for (const point of segment) {
        if (zones.some(({ center }) => haversineM(center, point) <= radiusM)) {
          endRun();
          continue;
        }
        const previous = run.at(-1);
        // Treat the rectangular edge bounds as a conservative guard for readers
        // that draw straight lines in their projection instead of great circles.
        if (previous && zones.some(({ center, bbox }) =>
          projectedEdgeIntersects(previous, point, bbox) ||
          (nearestOnTrack(center, [[{ ...previous, tSec: 0 }, { ...point, tSec: 1 }]])?.distanceM ?? Infinity) <= radiusM
        )) endRun();
        run.push(point);
      }
      endRun();
    }
    return kept;
  };
}
