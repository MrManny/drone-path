import { expect, it } from 'vitest';

import { decimateSegments, sampleSegments, summarizeTrack } from '../src/scan-track.js';

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

it.each([60, 500])('enforces a %d-vertex limit across GPS segments', (maxPoints) => {
  const segments = Array.from({ length: 20 }, (_, segment) =>
    Array.from({ length: 50 }, (_, i) => ({ lat: 45 + (i % 2), lon: 12 + i / 100, tSec: segment * 50 + i })));
  const output = decimateSegments(segments, maxPoints, 18);
  expect(output).toHaveLength(segments.length);
  expect(output.flat().length).toBeLessThanOrEqual(maxPoints);
  output.forEach((points, i) => {
    expect(points[0]).toEqual(segments[i][0]);
    expect(points.at(-1)).toEqual(segments[i].at(-1));
  });
});

it('keeps source fixes near 1 Hz and both endpoints of each GPS segment', () => {
  const segments = [[0, 0.03, 1, 1.5, 2.06], [9.75, 9.80, 9.9]].map((times) =>
    times.map((tSec) => ({ lat: 45, lon: 12, tSec })));
  expect(sampleSegments(segments).map(({ segment, tSec }) => [segment, tSec]))
    .toEqual([[0, 0], [0, 1], [0, 2.06], [1, 9.75], [1, 9.9]]);
});
