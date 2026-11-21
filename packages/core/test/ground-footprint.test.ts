import { expect, it } from 'vitest';

import { EARTH_RADIUS_M, haversineM } from '../src/geo.js';
import { footprintContains, projectGroundFootprint } from '../src/ground-footprint.js';

const position = { lat: 46, lon: 14, altitudeM: 100, pitchDeg: -90, yawDeg: 0 };
const fov = { horizontalDeg: 90, verticalDeg: 90 };
const toDegrees = 180 / (Math.PI * EARTH_RADIUS_M);

it('projects a 90-degree nadir view to a square twice as wide as the altitude', () => {
  const polygon = projectGroundFootprint(position, fov)!;
  expect(polygon).toHaveLength(4);
  expect(footprintContains(polygon, position)).toBe(true);
  expect(footprintContains(polygon, polygon[0])).toBe(true);
  for (const point of polygon) expect(haversineM(position, point)).toBeCloseTo(Math.sqrt(2) * 100, 1);
});

it.each([[0, 100, 0], [90, 0, 100], [-90, 0, -100], [180, -100, 0]])(
  'projects an oblique view along NED yaw %s',
  (yawDeg, north, east) => {
    const polygon = projectGroundFootprint({ ...position, yawDeg, pitchDeg: -45 })!;
    const point = { lat: position.lat + north * toDegrees, lon: position.lon + east * toDegrees / Math.cos(46 * Math.PI / 180) };
    expect(footprintContains(polygon, point)).toBe(true);
    expect(footprintContains(polygon, { lat: 2 * position.lat - point.lat, lon: 2 * position.lon - point.lon })).toBe(false);
  },
);

it.each([
  { pitchDeg: 1 }, { pitchDeg: 0 }, { pitchDeg: -26 }, { altitudeM: -1 }, { altitudeM: NaN }, { yawDeg: NaN },
])('omits an invalid or near-horizon footprint: %j', (change) => {
  expect(projectGroundFootprint({ ...position, ...change })).toBeNull();
});

it('contains points on both sides of the antimeridian', () => {
  const polygon = projectGroundFootprint({ ...position, lon: 179.9999 })!;
  expect(footprintContains(polygon, { lat: 46, lon: 180 })).toBe(true);
  expect(footprintContains(polygon, { lat: 46, lon: -179.9999 })).toBe(true);
  expect(footprintContains(polygon, { lat: 46, lon: 0 })).toBe(false);
});
