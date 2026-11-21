// Pure KML 2.2 serializer: one placemark per track segment. A segment whose
// vertices all carry trustworthy UTC becomes a timed gx:Track (the Google
// Earth flythrough); anything else becomes a plain LineString. Coordinates are
// always 3-tuples in meters: a segment with any unknown altitude uses 0 there
// and clamps the placemark to the ground, while fully known segments fly at
// absolute (mean sea level) altitude. No wall-clock or version strings, so
// identical input yields identical bytes.

import { isoUtc } from './track.js';
import type { TrackSegment, TrackVertex } from './track.js';

function altitudeMode(segment: TrackSegment): 'absolute' | 'clampToGround' {
  return segment.every((vertex) => vertex.altM !== null) ? 'absolute' : 'clampToGround';
}

// One coordinate rendering for both KML spellings: space-separated inside
// <gx:coord>, comma-separated inside <coordinates>.
function coordOf(vertex: TrackVertex, separator: string): string {
  return `${vertex.lon}${separator}${vertex.lat}${separator}${vertex.altM ?? 0}`;
}

function placemarkLines(segment: TrackSegment): string[] {
  const mode = altitudeMode(segment);
  const timed = segment.every((vertex) => vertex.timeMs !== null);
  const lines = ['    <Placemark>'];
  if (timed) {
    lines.push('      <gx:Track>', `        <altitudeMode>${mode}</altitudeMode>`);
    for (const vertex of segment) {
      lines.push(`        <when>${isoUtc(vertex.timeMs as number)}</when>`);
      lines.push(`        <gx:coord>${coordOf(vertex, ' ')}</gx:coord>`);
    }
    lines.push('      </gx:Track>');
  } else {
    lines.push('      <LineString>', `        <altitudeMode>${mode}</altitudeMode>`);
    lines.push(
      `        <coordinates>${segment.map((vertex) => coordOf(vertex, ',')).join(' ')}</coordinates>`,
    );
    lines.push('      </LineString>');
  }
  lines.push('    </Placemark>');
  return lines;
}

export function serializeKml(segments: readonly TrackSegment[]): string {
  return kmlDocument(segments.flatMap(placemarkLines));
}

export function serializeKmlTracks(tracks: readonly (readonly TrackSegment[])[]): string {
  return kmlDocument(tracks.flatMap((segments, index) => [
    '    <Folder>', `      <name>Flight ${index + 1}</name>`,
    ...segments.flatMap((segment) => placemarkLines(segment.length === 1 ? [segment[0], segment[0]] : segment))
      .map((line) => `  ${line}`),
    '    </Folder>',
  ]));
}

function kmlDocument(placemarks: readonly string[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
    '  <Document>',
  ];
  return lines.concat(placemarks, '  </Document>', '</kml>', '').join('\n');
}
