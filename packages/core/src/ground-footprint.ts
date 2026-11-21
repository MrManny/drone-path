import { EARTH_RADIUS_M } from './geo.js';
import type { Bbox, LatLon } from './geo.js';
import { bboxIntersects } from './spatial.js';

const RAD = Math.PI / 180;
const MIN_DOWN = Math.sin(5 * RAD);
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

export const DEFAULT_CAMERA_FOV = { horizontalDeg: 75, verticalDeg: 50 } as const;

export interface GroundCamera extends LatLon {
  altitudeM: number;
  pitchDeg: number;
  yawDeg: number;
  rollDeg?: number;
}

export type GroundFootprint = LatLon[];

function wrapLon(lon: number): number {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

export function projectGroundFootprint(
  camera: GroundCamera, fov: { horizontalDeg: number; verticalDeg: number } = DEFAULT_CAMERA_FOV,
): GroundFootprint | null {
  const { lat, lon, altitudeM, pitchDeg, yawDeg, rollDeg = 0 } = camera;
  const { horizontalDeg, verticalDeg } = fov;
  if (![lat, lon, altitudeM, pitchDeg, yawDeg, rollDeg, horizontalDeg, verticalDeg].every(Number.isFinite)
    || Math.abs(lat) >= 90 || Math.abs(lon) > 180 || altitudeM <= 0 || pitchDeg >= 0 || pitchDeg < -90
    || horizontalDeg <= 0 || horizontalDeg >= 180 || verticalDeg <= 0 || verticalDeg >= 180) return null;

  const pitch = -pitchDeg * RAD;
  const yaw = yawDeg * RAD;
  const roll = rollDeg * RAD;
  const halfWidth = Math.tan(horizontalDeg * RAD / 2);
  const halfHeight = Math.tan(verticalDeg * RAD / 2);
  const polygon: GroundFootprint = [];
  const offsets: number[] = [];
  for (const [x, y] of CORNERS) {
    const right = x * halfWidth * Math.cos(roll) - y * halfHeight * Math.sin(roll);
    const up = x * halfWidth * Math.sin(roll) + y * halfHeight * Math.cos(roll);
    const down = Math.sin(pitch) - up * Math.cos(pitch);
    if (down < MIN_DOWN * Math.hypot(1, right, up)) return null;
    const depth = altitudeM / down;
    const forward = Math.cos(pitch) + up * Math.sin(pitch);
    const north = depth * (forward * Math.cos(yaw) - right * Math.sin(yaw));
    const east = depth * (forward * Math.sin(yaw) + right * Math.cos(yaw));
    const vertexLat = lat + north / (EARTH_RADIUS_M * RAD);
    const deltaLon = east / (EARTH_RADIUS_M * RAD * Math.cos(lat * RAD));
    if (Math.abs(vertexLat) >= 90 || Math.abs(deltaLon) >= 90) return null;
    offsets.push(deltaLon);
    polygon.push({ lat: vertexLat, lon: wrapLon(lon + deltaLon) });
  }
  return Math.max(...offsets) - Math.min(...offsets) >= 180 ? null : polygon;
}

export function footprintBbox(polygon: readonly LatLon[]): Bbox {
  const reference = polygon[0].lon;
  const latitudes = polygon.map(({ lat }) => lat);
  const longitudes = polygon.map(({ lon }) => wrapLon(lon - reference));
  return {
    minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes),
    minLon: polygon[longitudes.indexOf(Math.min(...longitudes))].lon,
    maxLon: polygon[longitudes.indexOf(Math.max(...longitudes))].lon,
  };
}

export function footprintContains(polygon: GroundFootprint, point: LatLon): boolean {
  const bbox = footprintBbox(polygon);
  const lon = point.lon === 180 ? -180 : point.lon;
  if (!bboxIntersects(bbox, { minLat: point.lat, maxLat: point.lat, minLon: lon, maxLon: lon })) return false;
  const reference = polygon[0].lon;
  const x = wrapLon(point.lon - reference);
  const crosses = polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const ax = wrapLon(a.lon - reference);
    const bx = wrapLon(b.lon - reference);
    return (bx - ax) * (point.lat - a.lat) - (b.lat - a.lat) * (x - ax);
  });
  return crosses.every((value) => value >= -1e-14) || crosses.every((value) => value <= 1e-14);
}
