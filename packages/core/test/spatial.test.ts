import { expect, it } from 'vitest';

import { bboxIntersects, nearestOnTrack, radiusBbox } from '../src/spatial.js';

it('intersects inclusive bounds on either side of the antimeridian', () => {
  const viewport = { minLat: -2, maxLat: 2, minLon: 175, maxLon: -175 };
  expect(bboxIntersects(viewport, { minLat: 2, maxLat: 5, minLon: 174, maxLon: 175 })).toBe(true);
  expect(bboxIntersects(viewport, { minLat: -1, maxLat: 1, minLon: -179, maxLon: -176 })).toBe(true);
  expect(bboxIntersects(viewport, { minLat: -1, maxLat: 1, minLon: 174, maxLon: 174 })).toBe(false);
  expect(bboxIntersects(viewport, { minLat: 3, maxLat: 4, minLon: -180, maxLon: 180 })).toBe(false);
  expect(bboxIntersects(
    { minLat: 0, maxLat: 0, minLon: 180, maxLon: 180 },
    { minLat: 0, maxLat: 0, minLon: -180, maxLon: -180 },
  )).toBe(true);
});

it('constructs radius bounds that wrap at the antimeridian and cover all longitudes at a pole', () => {
  const wrapped = radiusBbox({ lat: 0, lon: 179.999 }, 1_000);
  expect(wrapped.minLon).toBeGreaterThan(wrapped.maxLon);
  expect(radiusBbox({ lat: 89.99, lon: 30 }, 2_000)).toMatchObject({
    maxLat: 90, minLon: -180, maxLon: 180,
  });
});

it('interpolates the closest timestamp on a short arc across the antimeridian', () => {
  const result = nearestOnTrack({ lat: 0.001, lon: 180 }, [[
    { lat: 0, lon: 179.999, tSec: 2 },
    { lat: 0, lon: -179.999, tSec: 10 },
  ]]);
  expect(result?.tSec).toBeCloseTo(6, 8);
  expect(result?.distanceM).toBeCloseTo(111.195, 2);
});

it('includes single fixes and keeps GPS gaps separate', () => {
  const point = { lat: 0, lon: 0 };
  const result = nearestOnTrack(point, [
    [],
    [{ lat: 0, lon: -0.001, tSec: 1 }],
    [{ lat: 0, lon: 0.001, tSec: 10 }],
  ]);
  expect(result?.tSec).toBe(1);
  expect(result?.distanceM).toBeCloseTo(111.195, 2);
  expect(nearestOnTrack(point, [[]])).toBeNull();
});

it('follows a great-circle arc over a pole', () => {
  const result = nearestOnTrack({ lat: 90, lon: 30 }, [[
    { lat: 80, lon: -90, tSec: 1 },
    { lat: 80, lon: 90, tSec: 3 },
  ]]);
  expect(result?.tSec).toBeCloseTo(2);
  expect(result?.distanceM).toBeCloseTo(0);
});
