import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { serializeGeoJson } from '../src/track-geojson.js';
import { serializeGpx } from '../src/track-gpx.js';
import { serializeKml } from '../src/track-kml.js';
import { kmzBytes } from '../src/track-kmz.js';
import { buildTrack } from '../src/track.js';
import type { TrackExportInput } from '../src/track-write.js';
import { trackFileBytes, writeTrackFile } from '../src/track-write.js';
import {
  buildTelemetryDocument,
  serializeTelemetryDocument,
  writeTelemetryDocument,
} from '../src/telemetry-json.js';
import type { TelemetryFrameInput } from '../src/telemetry-json.js';
import {
  TRACK_ROWS,
  cleanupTmpDirs,
  tmpDir,
  trackDocumentFixture,
  trackExportFixture,
} from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('trackFileBytes', () => {
  const input = trackExportFixture();

  it.each([
    ['flight.gpx', serializeGpx(buildTrack(TRACK_ROWS))],
    ['flight.geojson', serializeGeoJson(buildTrack(TRACK_ROWS))],
    ['flight.kml', serializeKml(buildTrack(TRACK_ROWS))],
  ] as const)('matches the serializer bytes for %s', (file, expected) => {
    expect(trackFileBytes(file, input, null)).toBe(expected);
  });

  it('wraps the KML for .kmz', () => {
    expect(
      (trackFileBytes('flight.kmz', input, null) as Buffer).equals(
        kmzBytes(serializeKml(buildTrack(TRACK_ROWS))),
      ),
    ).toBe(true);
  });

  it('produces the unchanged telemetry document bytes for .json', () => {
    expect(trackFileBytes('flight.json', input, null)).toBe(
      serializeTelemetryDocument(buildTelemetryDocument(input.document)),
    );
  });
});

describe('track export record selection', () => {
  // The cammeta-scan stream: three sample records spread over a 300-frame
  // clip at 30 fps - record count unrelated to the frame count.
  const scanRows: TelemetryFrameInput[] = [
    { lat: 1, lng: 2 },
    { lat: 3, lng: 4 },
    { lat: 5, lng: 6 },
  ];
  const scanInput: TrackExportInput = {
    document: { ...trackDocumentFixture(scanRows), frameCount: 300 },
    track: {
      records: [
        { ...scanRows[0], tSec: 0.5 },
        { ...scanRows[1], tSec: 5 },
        { ...scanRows[2], tSec: 6 },
      ],
      fpsValue: 30,
      frameCount: 300,
    },
  };

  it('keeps every record in a full export, even past the frame count', () => {
    const gpx = trackFileBytes('flight.gpx', scanInput, null) as string;
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
  });

  it('keeps every record when the stream carries more records than frames', () => {
    const rows: TelemetryFrameInput[] = Array.from({ length: 7 }, (_, i) => ({
      lat: 46.6 + i / 1e5,
      lng: 14.2,
    }));
    const input: TrackExportInput = {
      document: { ...trackDocumentFixture(rows), frameCount: 5 },
      track: {
        records: rows.map((row, i) => ({ ...row, tSec: i / 30 })),
        fpsValue: 30,
        frameCount: 5,
      },
    };
    const gpx = trackFileBytes('flight.gpx', input, null) as string;
    expect(gpx.match(/<trkpt /g)).toHaveLength(7);
  });

  it('rejects an out-of-bounds range like the document writer', () => {
    expect(() => trackFileBytes('flight.gpx', scanInput, { start: 0, end: 5000 })).toThrow(
      'frame range 0-5000 is beyond the recording (300 frames)',
    );
    expect(() => trackFileBytes('flight.kmz', scanInput, { start: 300, end: 300 })).toThrow(
      'beyond the recording (300 frames)',
    );
  });

  it('selects records by source time against the frame span, not by position', () => {
    // frames 150-200 hold the records at tSec 5 s and 6 s (frames 150 and
    // 180): a positional slice of this 3-record stream would find nothing
    const gpx = trackFileBytes('flight.gpx', scanInput, {
      start: 150,
      end: 200,
    }) as string;
    expect(gpx.match(/<trkpt /g)).toHaveLength(2);
    expect(gpx).toContain('lat="3"');
    expect(gpx).toContain('lat="5"');

    // frames 0-50 hold only the first record - never "the first 51 rows"
    const early = trackFileBytes('flight.gpx', scanInput, { start: 0, end: 50 }) as string;
    expect(early.match(/<trkpt /g)).toHaveLength(1);
    expect(early).toContain('lat="1"');
  });

  it('keeps a single-frame span to the records of that frame', () => {
    const gpx = trackFileBytes('flight.gpx', scanInput, { start: 180, end: 180 }) as string;
    expect(gpx.match(/<trkpt /g)).toHaveLength(1);
    expect(gpx).toContain('lat="5"');
  });

  it('still selects frame-aligned streams exactly like the positional slice', () => {
    const input = trackExportFixture();
    const gpx = trackFileBytes('flight.gpx', input, { start: 3, end: 4 }) as string;
    expect(gpx).toBe(serializeGpx(buildTrack(TRACK_ROWS.slice(3, 5))));
  });
});

describe('writeTrackFile', () => {
  it('writes the format bytes under a created folder', () => {
    const file = path.join(tmpDir(), 'nested', 'flight.gpx');
    writeTrackFile(file, trackExportFixture(), null);
    expect(fs.readFileSync(file, 'utf8')).toBe(serializeGpx(buildTrack(TRACK_ROWS)));
  });

  it('writes byte-identical telemetry documents for .json', () => {
    const dir = tmpDir();
    const viaTrack = path.join(dir, 'a', 'flight.json');
    const viaDocument = path.join(dir, 'b', 'flight.json');
    const input = trackExportFixture();
    writeTrackFile(viaTrack, input, null);
    writeTelemetryDocument(viaDocument, input.document);
    expect(fs.readFileSync(viaTrack)).toEqual(fs.readFileSync(viaDocument));
  });

  it('segments the telemetry document by the range like the document writer', () => {
    const file = path.join(tmpDir(), 'flight.json');
    writeTrackFile(file, trackExportFixture(), { start: 1, end: 3 });
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { frames: unknown[] };
    expect(doc.frames).toHaveLength(3);
  });

  it('rejects an unsupported extension before writing anything', () => {
    const file = path.join(tmpDir(), 'flight.txt');
    expect(() => writeTrackFile(file, trackExportFixture(), null)).toThrow(
      'unsupported track file extension',
    );
    expect(fs.existsSync(file)).toBe(false);
  });
});
