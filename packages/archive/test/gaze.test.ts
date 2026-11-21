import { expect, it } from 'vitest';

import { gazeBbox, sampleGaze } from '../src/gaze.js';

it('retains real frame times, samples at roughly one Hz, and omits missing attitudes or altitude', () => {
  const base = { lat: 46, lng: 14, altRel: 50, gimbalPitchDeg: -90, gimbalYawDeg: 0 };
  const samples = sampleGaze([
    { ...base, tSec: 0, gimbalPitchDeg: null },
    { ...base, tSec: 0.27 },
    { ...base, tSec: 1.02 },
    { ...base, tSec: 1.39, altRel: null },
    { ...base, tSec: 1.42 },
    { ...base, tSec: 5.25, gimbalYawDeg: null },
    { ...base, tSec: 5.39 },
  ]);
  expect(samples.map(({ tSec }) => tSec)).toEqual([0.27, 1.42, 5.39]);
  expect(gazeBbox(samples)).toMatchObject({ minLat: expect.any(Number), maxLon: expect.any(Number) });
  expect(gazeBbox([])).toBeNull();
});
