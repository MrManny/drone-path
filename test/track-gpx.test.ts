import { describe, expect, it } from 'vitest';

import { serializeGpx } from '../src/track-gpx.js';
import type { TrackSegment } from '../src/track.js';
import { buildTrack } from '../src/track.js';
import { TRACK_GPX_GOLDEN, TRACK_ROWS } from './fixtures.js';

describe('serializeGpx', () => {
  it('matches the golden bytes for the two-segment fixture', () => {
    expect(serializeGpx(buildTrack(TRACK_ROWS))).toBe(TRACK_GPX_GOLDEN);
  });

  it('is deterministic', () => {
    const track = buildTrack(TRACK_ROWS);
    expect(serializeGpx(track)).toBe(serializeGpx(track));
  });

  it('writes a <time> only for a vertex that carries trustworthy UTC', () => {
    const segment: TrackSegment = [
      {
        lat: 46.61307,
        lon: 14.262388,
        altM: 313.227,
        timeMs: Date.UTC(2026, 9, 17, 14, 30, 40, 123),
      },
      { lat: 46.613071, lon: 14.262389, altM: 313.427, timeMs: null },
    ];
    const gpx = serializeGpx([segment]);
    expect(gpx).toContain('<time>2026-10-17T14:30:40.123Z</time>');
    expect(gpx.match(/<time>/g)).toHaveLength(1);
  });

  it('writes one <trkseg> per segment', () => {
    expect(TRACK_GPX_GOLDEN.match(/<trkseg>/g)).toHaveLength(2);
    expect(TRACK_GPX_GOLDEN.match(/<\/trkseg>/g)).toHaveLength(2);
  });

  it('writes an empty track as a track without segments', () => {
    expect(serializeGpx([])).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="drone-path" xmlns="http://www.topografix.com/GPX/1/1">',
        '  <trk>',
        '  </trk>',
        '</gpx>',
        '',
      ].join('\n'),
    );
  });
});
