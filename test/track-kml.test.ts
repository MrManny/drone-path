import { describe, expect, it } from 'vitest';

import { serializeKml } from '../src/track-kml.js';
import type { TrackSegment } from '../src/track.js';
import { buildTrack } from '../src/track.js';
import { TRACK_KML_GOLDEN, TRACK_ROWS } from './fixtures.js';

describe('serializeKml', () => {
  it('matches the golden bytes for the two-segment fixture', () => {
    expect(serializeKml(buildTrack(TRACK_ROWS))).toBe(TRACK_KML_GOLDEN);
  });

  it('is deterministic and writes one placemark per segment', () => {
    const track = buildTrack(TRACK_ROWS);
    const text = serializeKml(track);
    expect(serializeKml(track)).toBe(text);
    expect(text.match(/<Placemark>/g)).toHaveLength(2);
  });

  it('falls back to LineString without trustworthy UTC times', () => {
    expect(TRACK_KML_GOLDEN).not.toContain('gx:Track');
    expect(TRACK_KML_GOLDEN).not.toContain('<when>');
    expect(TRACK_KML_GOLDEN.match(/<LineString>/g)).toHaveLength(2);
  });

  it('writes a timed segment as one gx:Track with paired <when> and <gx:coord>', () => {
    const segment: TrackSegment = [
      {
        lat: 46.61307,
        lon: 14.262388,
        altM: 313.227,
        timeMs: Date.UTC(2026, 9, 17, 14, 30, 40, 123),
      },
      {
        lat: 46.613071,
        lon: 14.262389,
        altM: 313.427,
        timeMs: Date.UTC(2026, 9, 17, 14, 30, 40, 156),
      },
    ];
    expect(serializeKml([segment])).toContain(
      [
        '      <gx:Track>',
        '        <altitudeMode>absolute</altitudeMode>',
        '        <when>2026-10-17T14:30:40.123Z</when>',
        '        <gx:coord>14.262388 46.61307 313.227</gx:coord>',
        '        <when>2026-10-17T14:30:40.156Z</when>',
        '        <gx:coord>14.262389 46.613071 313.427</gx:coord>',
        '      </gx:Track>',
      ].join('\n'),
    );
  });

  it('stays a LineString when only part of a segment is timed', () => {
    const text = serializeKml([
      [
        {
          lat: 46.61307,
          lon: 14.262388,
          altM: 313.227,
          timeMs: Date.UTC(2026, 9, 17, 14, 30, 40, 123),
        },
        { lat: 46.613071, lon: 14.262389, altM: 313.427, timeMs: null },
      ],
    ]);
    expect(text).not.toContain('gx:Track');
    expect(text).toContain('<LineString>');
    expect(text).not.toContain('<when>');
  });

  it('always writes 3-tuples: unknown altitude becomes 0 and clamps the placemark', () => {
    const text = serializeKml([
      [{ lat: 46.61307, lon: 14.262388, altM: 313.227, timeMs: null }],
      [{ lat: 46.613071, lon: 14.262389, altM: null, timeMs: null }],
      [
        { lat: 46.613072, lon: 14.26239, altM: 313.527, timeMs: null },
        { lat: 46.613073, lon: 14.262391, altM: null, timeMs: null },
      ],
    ]);
    expect(text).toContain('<coordinates>14.262388,46.61307,313.227</coordinates>');
    expect(text).toContain('<coordinates>14.262389,46.613071,0</coordinates>');
    expect(text).toContain('<coordinates>14.26239,46.613072,313.527 14.262391,46.613073,0</coordinates>');
    // fully known segments fly at absolute altitude, the rest clamps to ground
    expect(text.match(/<altitudeMode>absolute<\/altitudeMode>/g)).toHaveLength(1);
    expect(text.match(/<altitudeMode>clampToGround<\/altitudeMode>/g)).toHaveLength(2);
  });

  it('writes an empty track as a document without placemarks', () => {
    expect(serializeKml([])).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
        '  <Document>',
        '  </Document>',
        '</kml>',
        '',
      ].join('\n'),
    );
  });
});
