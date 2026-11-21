import { expect, it } from 'vitest';

import { splitTrackAtAntimeridian } from '../src/track-antimeridian.js';

it.each([1, -1])('interpolates the seam latitude in direction %s', (sign) => {
  const start = { lat: 0, lon: 179 * sign };
  const end = { lat: 2, lon: -179 * sign };
  expect(splitTrackAtAntimeridian([[start, end], [], [end]])).toEqual([
    [start, { lat: 1, lon: 180 * sign }],
    [{ lat: 1, lon: -180 * sign }, end],
    [end],
  ]);
});

it('keeps motion along the seam on one side without dividing by zero', () => {
  const start = { lat: 0, lon: 180 };
  const end = { lat: 1, lon: -180 };
  expect(splitTrackAtAntimeridian([[start, end]])).toEqual([
    [start], [{ lat: 0, lon: -180 }, end],
  ]);
});
