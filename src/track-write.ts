// The imperative shell for track exports: routes one export input to the
// format its file extension selects and writes the bytes. The .json format is
// the existing telemetry document, byte-for-byte unchanged (it is segmented
// and written by the very functions the --telemetry-json export has used);
// the track formats select their records by source time against the range.

import fs from 'node:fs';
import path from 'node:path';

import type { FrameRange } from './config.js';
import {
  buildTelemetryDocument,
  segmentTelemetryInput,
  serializeTelemetryDocument,
  writeTelemetryDocument,
} from './telemetry-json.js';
import type { TelemetryDocumentInput } from './telemetry-json.js';
import { serializeGeoJson } from './track-geojson.js';
import { serializeGpx } from './track-gpx.js';
import { serializeKml } from './track-kml.js';
import { kmzBytes } from './track-kmz.js';
import { trackFormatOf } from './track-format.js';
import { buildTrack, selectTrackRecords } from './track.js';
import type { TrackStream } from './track.js';

export interface TrackExportInput {
  /** The frame-indexed telemetry document records; serve the .json format. */
  document: TelemetryDocumentInput;
  /** The fix-faithful, time-keyed records; serve the track formats. */
  track: TrackStream;
}

export function trackFileBytes(
  file: string,
  input: TrackExportInput,
  range: FrameRange | null,
): string | Buffer {
  const format = trackFormatOf(file);
  if (format === 'json') {
    return serializeTelemetryDocument(
      buildTelemetryDocument(segmentTelemetryInput(input.document, range)),
    );
  }
  const track = buildTrack(selectTrackRecords(input.track, range));
  switch (format) {
    case 'gpx':
      return serializeGpx(track);
    case 'geojson':
      return serializeGeoJson(track);
    case 'kml':
      return serializeKml(track);
    case 'kmz':
      return kmzBytes(serializeKml(track));
  }
}

export function writeTrackFile(
  file: string,
  input: TrackExportInput,
  range: FrameRange | null,
): void {
  const format = trackFormatOf(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (format === 'json') {
    // Delegated so the telemetry document bytes can never drift.
    writeTelemetryDocument(file, segmentTelemetryInput(input.document, range));
    return;
  }
  fs.writeFileSync(file, trackFileBytes(file, input, range));
}
