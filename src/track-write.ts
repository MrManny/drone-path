// The imperative shell for track exports: routes one telemetry input to the
// format its file extension selects and writes the bytes. The .json format is
// the existing telemetry document, byte-for-byte unchanged (it is serialized
// and written by the very functions the --telemetry-json export has used).

import fs from 'node:fs';
import path from 'node:path';

import { trackFormatOf } from './track-format.js';
import { serializeGeoJson } from './track-geojson.js';
import { serializeGpx } from './track-gpx.js';
import { serializeKml } from './track-kml.js';
import { kmzBytes } from './track-kmz.js';
import { buildTrack } from './track.js';
import {
  buildTelemetryDocument,
  serializeTelemetryDocument,
  writeTelemetryDocument,
} from './telemetry-json.js';
import type { TelemetryDocumentInput } from './telemetry-json.js';

export function trackFileBytes(
  file: string,
  input: TelemetryDocumentInput,
): string | Buffer {
  const format = trackFormatOf(file);
  if (format === 'json') {
    return serializeTelemetryDocument(buildTelemetryDocument(input));
  }
  const track = buildTrack(input.frames.slice(0, input.frameCount));
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

export function writeTrackFile(file: string, input: TelemetryDocumentInput): void {
  const format = trackFormatOf(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (format === 'json') {
    // Delegated so the telemetry document bytes can never drift.
    writeTelemetryDocument(file, input);
    return;
  }
  fs.writeFileSync(file, trackFileBytes(file, input));
}
