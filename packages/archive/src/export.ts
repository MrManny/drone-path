import fs from 'node:fs';
import path from 'node:path';

import type { LatLon } from 'drone-path-core/geo';
import { launchRedactor } from 'drone-path-core/launch-redaction';
import {
  markerFormatOf,
  serializeDaVinciResolveCsv,
  serializeFcpxmlMarkers,
} from 'drone-path-core/nle-markers';
import type { MarkerRange } from 'drone-path-core/nle-markers';
import { splitTrackAtAntimeridian } from 'drone-path-core/track-antimeridian';
import { trackFormatOf } from 'drone-path-core/track-format';
import { serializeGeoJsonTracks } from 'drone-path-core/track-geojson';
import { serializeGpxTracks } from 'drone-path-core/track-gpx';
import { serializeKmlTracks } from 'drone-path-core/track-kml';
import { kmzBytes } from 'drone-path-core/track-kmz';
import type { TrackSegment } from 'drone-path-core/track';

import { archiveMapHtml } from './export-map.js';
import type { MapFlight } from './export-map.js';
import { groupFlightMembers } from './flight-members.js';
import { listArchiveSegments, matchesMetadata, segmentFilterOf } from './query.js';
import type { ArchiveSegment, ListFilters } from './query.js';
import { withArchiveStore } from './store.js';

interface ExportOptions {
  filters?: ListFilters;
  redactLaunchM?: number;
  includeGaze?: boolean;
}

function exportFlights(
  db: string, { filters = {}, redactLaunchM = 0, includeGaze = false }: ExportOptions, splitDateline = false,
): MapFlight[] {
  if (!Number.isFinite(redactLaunchM) || redactLaunchM < 0) {
    throw new Error('expected a nonnegative launch redaction radius in meters');
  }
  const redact = redactLaunchM > 0;
  const segmentFilter = segmentFilterOf(filters);
  return withArchiveStore(db, (store) => {
    const { clips, endpoints } = store.readExportCandidates(
      filters.bbox, filters.availability, ({ record }) => matchesMetadata(record, filters),
      { redact, includeGaze: includeGaze && !redact },
      segmentFilter,
    );
    const redactTrack = launchRedactor(endpoints, redactLaunchM);
    const flights = groupFlightMembers(clips);
    return [...flights.values()].flatMap((members) => {
      const selected = members.flatMap(({ record, availability, gaze }) => {
        const geometry = splitDateline ? splitTrackAtAntimeridian(record.track) : record.track;
        const track = redactTrack(geometry).map((segment) => segment.map(({ lat, lon }): LatLon => ({ lat, lon })));
        if (track.length === 0 && gaze.length === 0) return [];
        return [{
          track,
          gaze: gaze.map(({ polygon }) => polygon),
          label: redact ? undefined : record.path.split(/[\\/]/u).at(-1),
          availability: redact ? undefined : availability,
        }];
      });
      return selected.length > 0 ? [{ clips: selected }] : [];
    });
  });
}

function writeExport(db: string, output: string, content: string | Buffer): void {
  const resolved = (file: string) => fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file);
  const outputPath = resolved(output);
  const databasePath = resolved(db);
  const samePath = process.platform === 'win32' ?
    outputPath.toLowerCase() === databasePath.toLowerCase() : outputPath === databasePath;
  if (samePath) throw new Error('export file cannot overwrite the archive database');
  if (fs.existsSync(output) && fs.existsSync(db)) {
    const target = fs.statSync(output, { bigint: true });
    const database = fs.statSync(db, { bigint: true });
    if (target.dev === database.dev && target.ino === database.ino) {
      throw new Error('export file cannot overwrite the archive database');
    }
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content);
}

export function exportArchiveMap(db: string, output: string, options: ExportOptions & { offline?: boolean } = {}): void {
  if (path.extname(output).toLowerCase() !== '.html') throw new Error('expected an .html output file');
  writeExport(db, output, archiveMapHtml(exportFlights(db, options), { offline: options.offline }));
}

export function exportArchiveTracks(db: string, output: string, options: Omit<ExportOptions, 'includeGaze'> = {}): void {
  const format = trackFormatOf(output);
  if (format === 'json') throw new Error('expected a .gpx, .geojson, .kml, or .kmz output file');
  const tracks: TrackSegment[][] = exportFlights(db, { ...options, includeGaze: false }, true).map(({ clips }) =>
    clips.flatMap(({ track }) => track.map((segment) =>
      segment.map(({ lat, lon }) => ({ lat, lon, altM: null, timeMs: null })),
    )),
  );
  switch (format) {
    case 'gpx': return writeExport(db, output, serializeGpxTracks(tracks));
    case 'geojson': return writeExport(db, output, serializeGeoJsonTracks(tracks));
    case 'kml': return writeExport(db, output, serializeKmlTracks(tracks));
    case 'kmz': return writeExport(db, output, kmzBytes(serializeKmlTracks(tracks)));
  }
}

function segmentToMarkerRange(segment: ArchiveSegment): MarkerRange {
  const video = segment.clip.video;
  if (
    !video ||
    video.durationSec === null ||
    !Number.isFinite(video.durationSec) ||
    video.durationSec <= 0 ||
    !Number.isFinite(video.fps.value) ||
    video.fps.value <= 0
  ) {
    throw new Error(`clip ${segment.clip.path} is missing video timing metadata for marker export`);
  }
  const durationSec = video.durationSec;
  const startSec = Math.max(0, Math.min(durationSec, segment.startSec));
  const endSec = Math.max(startSec, Math.min(durationSec, segment.endSec));
  const clipName = segment.clip.path.split(/[\\/]/u).at(-1);
  return {
    clipPath: segment.clip.path,
    ...(clipName ? { clipName } : {}),
    fps: video.fps,
    durationSec,
    startSec,
    endSec,
    label: segment.type,
    note:
      `smoothness ${segment.smoothness.toFixed(3)}, ` +
      `speed ${segment.meanSpeedMps.toFixed(2)} m/s, ` +
      `yawRate ${segment.meanYawRateDegPerSec.toFixed(2)} deg/s`,
  };
}

export function exportArchiveMarkers(
  db: string,
  output: string,
  options: { filters?: ListFilters } = {},
): void {
  const format = markerFormatOf(output);
  const segments = listArchiveSegments(db, options.filters);
  const markers = segments.map(segmentToMarkerRange);
  const content =
    format === 'csv'
      ? serializeDaVinciResolveCsv(markers)
      : serializeFcpxmlMarkers(markers);
  writeExport(db, output, content);
}
