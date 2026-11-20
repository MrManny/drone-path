import { describe, expect, it } from 'vitest';

import { buildTrack, selectTrackRecords } from '../src/track.js';
import type { TrackRecord } from '../src/track.js';
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

describe('selectTrackRecords', () => {
  const scan: TrackRecord[] = [
    { lat: 1, lng: 2, tSec: 0.5 }, // frame 15 at 30 fps
    { lat: 3, lng: 4, tSec: 5 }, // frame 150
    { lat: 5, lng: 6, tSec: 6 }, // frame 180
  ];
  const stream = { records: scan, fpsValue: 30, frameCount: 300 };

  it('keeps every record without a range, whatever the frame count', () => {
    expect(selectTrackRecords(stream, null)).toEqual(scan);
  });

  it('selects by source time against the frame span, never by record position', () => {
    expect(selectTrackRecords(stream, { start: 150, end: 200 })).toEqual([scan[1], scan[2]]);
    expect(selectTrackRecords(stream, { start: 0, end: 50 })).toEqual([scan[0]]);
    expect(selectTrackRecords(stream, { start: 170, end: 190 })).toEqual([scan[2]]);
  });

  it('keeps a single-frame span to the records of that frame', () => {
    expect(selectTrackRecords(stream, { start: 180, end: 180 })).toEqual([scan[2]]);
  });

  it('selects frame-aligned streams exactly like the positional slice', () => {
    const aligned: TrackRecord[] = [0, 1, 2, 3, 4].map((frame) => ({
      lat: 46.6 + frame / 1e5,
      lng: 14.2,
      tSec: frame / 30,
    }));
    expect(
      selectTrackRecords({ records: aligned, fpsValue: 30, frameCount: 5 }, { start: 1, end: 3 }),
    ).toEqual(aligned.slice(1, 4));
  });

  it('keeps several records that fall on one frame together', () => {
    const burst: TrackRecord[] = [
      { lat: 1, lng: 2, tSec: 5 },
      { lat: 3, lng: 4, tSec: 5.01 },
    ];
    expect(
      selectTrackRecords({ records: burst, fpsValue: 30, frameCount: 300 }, { start: 150, end: 150 }),
    ).toEqual(burst);
  });

  it('rejects invalid and out-of-bounds ranges like the document path', () => {
    expect(() => selectTrackRecords(stream, { start: 0, end: 5000 })).toThrow(
      'frame range 0-5000 is beyond the recording (300 frames)',
    );
    expect(() => selectTrackRecords(stream, { start: 3, end: 1 })).toThrow('0 <= start <= end');
  });

  it('keeps the final sample of a spread sample stream at the clip end', () => {
    // spreadSampleTimes puts the last scan sample at exactly the clip
    // duration: 10 s of 300 frames at 30 fps maps to frame 300, one past
    // the last frame - it belongs to the last frame and must export
    const spread: TrackRecord[] = [
      { lat: 1, lng: 2, tSec: 5 },
      { lat: 3, lng: 4, tSec: 10 },
    ];
    const clip = { records: spread, fpsValue: 30, frameCount: 300 };
    expect(selectTrackRecords(clip, { start: 0, end: 299 })).toEqual(spread);
    expect(selectTrackRecords(clip, { start: 0, end: 299 }).at(-1)).toEqual(
      selectTrackRecords(clip, null).at(-1),
    );
    expect(selectTrackRecords(clip, { start: 299, end: 299 })).toEqual([spread[1]]);
  });
});
