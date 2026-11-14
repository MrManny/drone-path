import { describe, expect, it } from 'vitest';

import { TRACK_FORMAT_VALUES, trackFormatOf } from '../src/track-format.js';

describe('trackFormatOf', () => {
  it.each([
    ['flight.gpx', 'gpx'],
    ['flight.geojson', 'geojson'],
    ['flight.kml', 'kml'],
    ['flight.kmz', 'kmz'],
    ['flight.json', 'json'],
    ['flight.telemetry.json', 'json'],
    ['C:\\tracks\\flight.GPX', 'gpx'],
    ['C:\\tracks\\flight.GeoJSON', 'geojson'],
    ['dir.with.dots/flight.KML', 'kml'],
    ['/home/pilot/flight.KMZ', 'kmz'],
    ['flight.JSON', 'json'],
  ] as const)('selects %s -> %s', (file, format) => {
    expect(trackFormatOf(file)).toBe(format);
    expect(TRACK_FORMAT_VALUES).toContain(format);
  });

  it.each([
    ['flight.txt'],
    ['flight.csv'],
    ['flight.json.bak'],
    ['flightgpx'],
    ['flight.'],
    ['flight'],
    [''],
  ] as const)('rejects %s with a plain lowercase error', (file) => {
    expect(() => trackFormatOf(file)).toThrow(
      `unsupported track file extension: ${file} (use .gpx, .geojson, .kml, .kmz or .json)`,
    );
    expect(() => trackFormatOf(file)).toThrow(Error);
  });
});
