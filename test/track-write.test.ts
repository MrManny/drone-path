import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { serializeGeoJson } from '../src/track-geojson.js';
import { serializeGpx } from '../src/track-gpx.js';
import { serializeKml } from '../src/track-kml.js';
import { kmzBytes } from '../src/track-kmz.js';
import { buildTrack } from '../src/track.js';
import { trackFileBytes, writeTrackFile } from '../src/track-write.js';
import {
  buildTelemetryDocument,
  serializeTelemetryDocument,
  writeTelemetryDocument,
} from '../src/telemetry-json.js';
import {
  TRACK_ROWS,
  cleanupTmpDirs,
  tmpDir,
  trackDocumentFixture,
} from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('trackFileBytes', () => {
  const input = trackDocumentFixture();

  it.each([
    ['flight.gpx', serializeGpx(buildTrack(TRACK_ROWS))],
    ['flight.geojson', serializeGeoJson(buildTrack(TRACK_ROWS))],
    ['flight.kml', serializeKml(buildTrack(TRACK_ROWS))],
  ] as const)('matches the serializer bytes for %s', (file, expected) => {
    expect(trackFileBytes(file, input)).toBe(expected);
  });

  it('wraps the KML for .kmz', () => {
    expect((trackFileBytes('flight.kmz', input) as Buffer).equals(kmzBytes(serializeKml(buildTrack(TRACK_ROWS))))).toBe(true);
  });

  it('produces the unchanged telemetry document bytes for .json', () => {
    expect(trackFileBytes('flight.json', input)).toBe(
      serializeTelemetryDocument(buildTelemetryDocument(input)),
    );
  });
});

describe('writeTrackFile', () => {
  it('writes the format bytes under a created folder', () => {
    const file = path.join(tmpDir(), 'nested', 'flight.gpx');
    writeTrackFile(file, trackDocumentFixture());
    expect(fs.readFileSync(file, 'utf8')).toBe(serializeGpx(buildTrack(TRACK_ROWS)));
  });

  it('writes byte-identical telemetry documents for .json', () => {
    const dir = tmpDir();
    const viaTrack = path.join(dir, 'a', 'flight.json');
    const viaDocument = path.join(dir, 'b', 'flight.json');
    const input = trackDocumentFixture();
    writeTrackFile(viaTrack, input);
    writeTelemetryDocument(viaDocument, input);
    expect(fs.readFileSync(viaTrack)).toEqual(fs.readFileSync(viaDocument));
  });

  it('rejects an unsupported extension before writing anything', () => {
    const file = path.join(tmpDir(), 'flight.txt');
    expect(() => writeTrackFile(file, trackDocumentFixture())).toThrow(
      'unsupported track file extension',
    );
    expect(fs.existsSync(file)).toBe(false);
  });
});
