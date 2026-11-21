import path from 'node:path';

import { expect, it } from 'vitest';

import { groupFlights } from '../src/flight-grouping.js';
import type { FlightClip } from '../src/flight-grouping.js';

function clip(sequence: number, overrides: Partial<FlightClip> = {}): FlightClip {
  return {
    key: path.join('library', `DJI_${String(sequence).padStart(4, '0')}.MP4`),
    size: 400_000_000,
    startMs: 60_000 * (sequence - 1),
    durationSec: 50,
    firstFix: { lat: 46, lon: 14, tSec: 0 },
    lastFix: { lat: 46.0002, lon: 14, tSec: 49.95 },
    ...overrides,
  };
}

it.each([
  ['DJI_0001.MP4', 'DJI_0002.MP4'],
  ['dji_fly_20260808_124720_0007_1786187878090_video.mp4', 'dji_fly_20260808_124810_0008_1786187928090_video.mp4'],
  ['DJI_9999.MP4', 'DJI_0000.MP4'],
])('links a continuous split for %s and %s', (first, second) => {
  const a = clip(1, { key: path.join('library', first), size: 4_200_000_000 });
  const b = clip(2, { key: path.join('library', second), startMs: 50_900, firstFix: { ...a.lastFix!, tSec: 0 } });
  const result = groupFlights([a, b]);
  const prior = result.find(({ key }) => key === a.key);
  expect(result.find(({ key }) => key === b.key)).toEqual({
    key: b.key, flightId: prior?.flightId, order: 1, splitFromKey: a.key,
  });
  expect(groupFlights([b, a])).toEqual(result);
});

it('groups nearby clips from the same session without labeling them as splits', () => {
  const result = groupFlights([clip(3), clip(1), clip(2, {
    startMs: 75_000, durationSec: 40, lastFix: { ...clip(2).lastFix!, tSec: 39.95 },
  })]);
  expect(result).toMatchObject([
    { order: 0, splitFromKey: null }, { order: 1, splitFromKey: null }, { order: 2, splitFromKey: null },
  ]);
  expect(new Set(result.map(({ flightId }) => flightId)).size).toBe(1);
});

it.each([
  ['an ordinary file size', 500_000_000, 50_100, 0],
  ['a gap between the recordings', 4_000_000_000, 54_000, 0],
  ['a delayed GPS fix', 4_000_000_000, 50_100, 3],
] as const)('does not classify a cut as a split with %s', (_case, size, startMs, firstFixTime) => {
  const previous = clip(1, { size });
  const next = clip(2, { startMs, firstFix: { ...previous.lastFix!, tSec: firstFixTime } });
  const [a, b] = groupFlights([previous, next]);
  expect(b).toMatchObject({ flightId: a.flightId, order: 1, splitFromKey: null });
});

it.each<[string, Partial<FlightClip>, Partial<FlightClip>]>([
  ['separate battery sessions', {}, { startMs: 200_000 }],
  ['return to launch', { lastFix: { lat: 46, lon: 14, tSec: 49.95 } }, {}],
  ['a missing or unzoned timestamp', { startMs: null }, {}],
  ['an invalid timestamp', {}, { startMs: NaN }],
  ['missing boundary GPS fixes', {}, { firstFix: undefined }],
  ['a distant next location', {}, { firstFix: { lat: 47, lon: 14, tSec: 0 } }],
  ['different source folders', {}, { key: path.join('other', 'DJI_0002.MP4') }],
  ['a filename sequence break', {}, { key: path.join('library', 'DJI_0003.MP4') }],
])('keeps clips separate for %s', (_case, previous, next) => {
  expect(new Set(groupFlights([clip(1, previous), clip(2, next)]).map(({ flightId }) => flightId)).size).toBe(2);
});

it('does not assign a continuation when another clip competes for the time range', () => {
  const result = groupFlights([clip(1), clip(2), clip(3, { startMs: 61_000, firstFix: undefined })]);
  expect(new Set(result.map(({ flightId }) => flightId)).size).toBe(3);
});
