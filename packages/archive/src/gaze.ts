import { footprintBbox, projectGroundFootprint } from 'drone-path-core/ground-footprint';
import type { GroundFootprint } from 'drone-path-core/ground-footprint';
import type { Bbox } from 'drone-path-core/geo';
import type { TrackRecord } from 'drone-path-core/track';

export interface GazeSample {
  tSec: number;
  polygon: GroundFootprint;
}

export function sampleGaze(records: readonly TrackRecord[]): GazeSample[] {
  const samples: GazeSample[] = [];
  let nextSec = -Infinity;
  for (const { tSec, lat, lng, altRel, gimbalPitchDeg, gimbalYawDeg, gimbalRollDeg } of records) {
    if (!Number.isFinite(tSec) || tSec < nextSec || typeof lat !== 'number' || typeof lng !== 'number' || typeof altRel !== 'number'
      || typeof gimbalPitchDeg !== 'number' || typeof gimbalYawDeg !== 'number') continue;
    const polygon = projectGroundFootprint({
      lat, lon: lng, altitudeM: altRel, pitchDeg: gimbalPitchDeg, yawDeg: gimbalYawDeg,
      rollDeg: gimbalRollDeg ?? 0,
    });
    if (polygon === null) continue;
    samples.push({ tSec, polygon });
    nextSec = tSec + 1;
  }
  return samples;
}

export function gazeBbox(samples: readonly GazeSample[]): Bbox | null {
  if (samples.length === 0) return null;
  const bounds: Bbox = { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 };
  for (const { polygon } of samples) {
    const bbox = footprintBbox(polygon);
    bounds.minLat = Math.min(bounds.minLat, bbox.minLat);
    bounds.maxLat = Math.max(bounds.maxLat, bbox.maxLat);
    bounds.minLon = Math.min(bounds.minLon, bbox.minLon > bbox.maxLon ? -180 : bbox.minLon);
    bounds.maxLon = Math.max(bounds.maxLon, bbox.minLon > bbox.maxLon ? 180 : bbox.maxLon);
  }
  return bounds;
}
