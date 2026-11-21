import { expect, it } from 'vitest';

import { summarizeTrack } from '../src/scan-track.js';

it('keeps the original source timestamps on a simplified track', () => {
  const summary = summarizeTrack([
    { lat: 45, lng: 12, tSec: 1 },
    { lat: 45, lng: 13, tSec: 3 },
    { lat: 45, lng: 14, tSec: 9 },
  ]);
  expect(summary.track).toEqual([[{ lat: 45, lon: 12, tSec: 1 }, { lat: 45, lon: 14, tSec: 9 }]]);
  expect(summary.trackDistanceM).toBeGreaterThan(100_000);
  expect(summary.fixCount).toBe(3);
});

it('has no geometry for records without fixes', () => {
  expect(summarizeTrack([{ lat: null, lng: null, tSec: 0 }])).toEqual({
    track: [], bbox: null, fixCount: 0, trackDistanceM: 0,
  });
});
