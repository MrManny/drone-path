import { describe, expect, it } from 'vitest';

import { serializeGeoJson } from '../src/track-geojson.js';
import type { TrackSegment } from '../src/track.js';
import { buildTrack } from '../src/track.js';
import { TRACK_GEOJSON_GOLDEN, TRACK_ROWS } from './fixtures.js';

describe('serializeGeoJson', () => {
  it('matches the golden bytes for the two-segment fixture', () => {
    expect(serializeGeoJson(buildTrack(TRACK_ROWS))).toBe(TRACK_GEOJSON_GOLDEN);
  });

  it('is deterministic and valid JSON with one MultiLineString line per segment', () => {
    const track = buildTrack(TRACK_ROWS);
    const text = serializeGeoJson(track);
    expect(serializeGeoJson(track)).toBe(text);
    const doc = JSON.parse(text) as {
      type: string;
      geometry: { type: string; coordinates: number[][][] };
      properties: Record<string, unknown>;
    };
    expect(doc.type).toBe('Feature');
    expect(doc.geometry.type).toBe('MultiLineString');
    expect(doc.geometry.coordinates).toEqual([
      [[14.262388, 46.61307, 313.227], [14.262389, 46.613071, 313.427]],
      [[14.26239, 46.613072, 313.527], [14.262391, 46.613073]],
    ]);
    expect(doc.properties).toEqual({});
  });

  it('writes coordinateProperties.times only when every vertex carries trustworthy UTC', () => {
    const timed: TrackSegment = [
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
    const text = serializeGeoJson([timed]);
    const doc = JSON.parse(text) as {
      properties: { coordinateProperties: { times: string[][] } };
    };
    expect(doc.properties.coordinateProperties.times).toEqual([
      ['2026-10-17T14:30:40.123Z', '2026-10-17T14:30:40.156Z'],
    ]);
    expect(text).toContain('"times"');

    const mixed = serializeGeoJson([[{ ...timed[0] }, { ...timed[1], timeMs: null }]]);
    expect(mixed).not.toContain('"times"');
    expect(JSON.parse(mixed)).toHaveProperty('properties', {});
  });

  it('writes an empty track as a feature without lines', () => {
    const doc = JSON.parse(serializeGeoJson([])) as {
      geometry: { coordinates: number[][][] };
      properties: Record<string, unknown>;
    };
    expect(doc.geometry.coordinates).toEqual([]);
    expect(doc.properties).toEqual({});
  });
});
