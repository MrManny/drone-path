// Pure KML 2.2 serializer: one placemark per track segment. A segment whose
// vertices all carry trustworthy UTC becomes a timed gx:Track (the Google
// Earth flythrough); anything else becomes a plain LineString. Coordinates are
// always 3-tuples in meters: a segment with any unknown altitude uses 0 there
// and clamps the placemark to the ground, while fully known segments fly at
// absolute (mean sea level) altitude. No wall-clock or version strings, so
// identical input yields identical bytes.

import type { TrackSegment, TrackVertex } from './track.js';

function isoUtc(timeMs: number): string {
  return new Date(timeMs).toISOString();
}

function altitudeMode(segment: TrackSegment): 'absolute' | 'clampToGround' {
  return segment.every((vertex) => vertex.altM !== null) ? 'absolute' : 'clampToGround';
}

function coordTuple(vertex: TrackVertex): string {
  return `${vertex.lon} ${vertex.lat} ${vertex.altM ?? 0}`;
}

function coordinatesTuple(vertex: TrackVertex): string {
  return `${vertex.lon},${vertex.lat},${vertex.altM ?? 0}`;
}

function placemarkLines(segment: TrackSegment): string[] {
  const mode = altitudeMode(segment);
  const timed = segment.every((vertex) => vertex.timeMs !== null);
  const lines = ['    <Placemark>'];
  if (timed) {
    lines.push('      <gx:Track>', `        <altitudeMode>${mode}</altitudeMode>`);
    for (const vertex of segment) {
      lines.push(`        <when>${isoUtc(vertex.timeMs as number)}</when>`);
      lines.push(`        <gx:coord>${coordTuple(vertex)}</gx:coord>`);
    }
    lines.push('      </gx:Track>');
  } else {
    lines.push('      <LineString>', `        <altitudeMode>${mode}</altitudeMode>`);
    lines.push(
      `        <coordinates>${segment.map(coordinatesTuple).join(' ')}</coordinates>`,
    );
    lines.push('      </LineString>');
  }
  lines.push('    </Placemark>');
  return lines;
}

export function serializeKml(segments: readonly TrackSegment[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
    '  <Document>',
  ];
  for (const segment of segments) lines.push(...placemarkLines(segment));
  lines.push('  </Document>', '</kml>', '');
  return lines.join('\n');
}
