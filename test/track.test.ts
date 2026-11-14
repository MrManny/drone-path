import { describe, expect, it } from 'vitest';

import { buildTrack } from '../src/track.js';
import type { TelemetryFrameInput } from '../src/telemetry-json.js';
import { TRACK_ROWS } from './fixtures.js';

describe('buildTrack', () => {
  it('puts one vertex on every decoded GPS fix', () => {
    const track = buildTrack(TRACK_ROWS);
    expect(track).toHaveLength(2);
    expect(track[0]).toHaveLength(2);
    expect(track[1]).toHaveLength(2);
    expect(track[0][0]).toEqual({ lat: 46.61307, lon: 14.262388, altM: 313.227, timeMs: null });
    expect(track[1][1]).toEqual({ lat: 46.613073, lon: 14.262391, altM: null, timeMs: null });
  });

  it('breaks the line at a telemetry gap and never interpolates', () => {
    const rows: TelemetryFrameInput[] = [
      { lat: 1, lng: 2, altAbs: 10 },
      { lat: null, lng: null },
      { lat: null, lng: null },
      { lat: 3, lng: 4, altAbs: 11 },
    ];
    const track = buildTrack(rows);
    expect(track.map((segment) => segment.map((v) => [v.lat, v.lon]))).toEqual([
      [[1, 2]],
      [[3, 4]],
    ]);
  });

  it('keeps a segment of a single fix', () => {
    const track = buildTrack([
      { lat: 1, lng: 2 },
      { lat: null, lng: null },
      { lat: 3, lng: 4 },
    ]);
    expect(track).toHaveLength(2);
    expect(track[0]).toHaveLength(1);
    expect(track[1]).toHaveLength(1);
  });

  it('drops leading and trailing gap runs without empty segments', () => {
    const track = buildTrack([
      { lat: null, lng: null },
      { lat: 1, lng: 2 },
      { lat: null, lng: null },
    ]);
    expect(track).toEqual([[{ lat: 1, lon: 2, altM: null, timeMs: null }]]);
  });

  it('treats a half-present position as no fix', () => {
    const track = buildTrack([
      { lat: 1, lng: null },
      { lat: 1, lng: 2, altAbs: 10 },
    ]);
    expect(track).toEqual([[{ lat: 1, lon: 2, altM: 10, timeMs: null }]]);
  });

  it('exports no vertices without any fixes', () => {
    expect(buildTrack([])).toEqual([]);
    expect(buildTrack([{ lat: null, lng: null }, { lat: 0, lng: 0, altAbs: 0 }])).toEqual([
      [{ lat: 0, lon: 0, altM: 0, timeMs: null }],
    ]);
  });
});

describe('buildTrack altitude policy', () => {
  it.each([
    ['absolute altitude first', { altAbs: 313.227, altRel: 3.3, gpsAltMm: 313500 }, 313.227],
    ['GPS altitude in millimeters when absolute is missing', { altRel: 3300, gpsAltMm: 313527 }, 313.527],
    ['relative altitude alone is not exported', { altRel: 3300 }, null],
    ['kept at zero', { altAbs: 0 }, 0],
    ['unknown', {}, null],
  ] as const)('%s', (_name, values, expected) => {
    const track = buildTrack([{ lat: 1, lng: 2, ...values }]);
    expect(track[0][0].altM).toBe(expected);
  });
});

describe('buildTrack time policy', () => {
  it('exports no time from the device timestamp (ms since power-up, not UTC)', () => {
    const track = buildTrack([{ lat: 1, lng: 2, gimbalDeviceTimestampMs: 34229 }]);
    expect(track[0][0].timeMs).toBeNull();
  });
});
