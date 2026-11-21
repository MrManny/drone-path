// Pure GPX 1.1 serializer: one <trkseg> per track segment, altitude as <ele>,
// and a <time> only where the vertex carries trustworthy UTC. No metadata
// wall-clock or version strings, so identical input yields identical bytes.

import { isoUtc } from './track.js';
import type { TrackSegment, TrackVertex } from './track.js';

function decimal(value: number): string {
  const text = String(value);
  const scientific = /^(-?)(\d)(?:\.(\d+))?e([+-]?\d+)$/u.exec(text);
  if (!scientific) return text;
  const [, sign, digit, fraction = '', exponent] = scientific;
  const digits = digit + fraction;
  const position = 1 + Number(exponent);
  if (position <= 0) return sign + '0.' + '0'.repeat(-position) + digits;
  if (position >= digits.length) return sign + digits + '0'.repeat(position - digits.length);
  return sign + digits.slice(0, position) + '.' + digits.slice(position);
}

// GPX 1.1's longitude domain excludes the east edge of the antimeridian.
const GPX_EAST_EDGE = 179.99999999999997;

function trkptLines(vertex: TrackVertex): string[] {
  const lat = decimal(vertex.lat);
  const lon = decimal(vertex.lon === 180 ? GPX_EAST_EDGE : vertex.lon);
  const children: string[] = [];
  if (vertex.altM !== null) children.push(`<ele>${decimal(vertex.altM)}</ele>`);
  if (vertex.timeMs !== null) children.push(`<time>${isoUtc(vertex.timeMs)}</time>`);
  const open = `<trkpt lat="${lat}" lon="${lon}">`;
  if (children.length === 0) return [`      <trkpt lat="${lat}" lon="${lon}"/>`];
  return [
    `      ${open}`,
    ...children.map((child) => `        ${child}`),
    '      </trkpt>',
  ];
}

export function serializeGpx(segments: readonly TrackSegment[]): string {
  return serializeGpxTracks([segments]);
}

export function serializeGpxTracks(tracks: readonly (readonly TrackSegment[])[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="drone-path" xmlns="http://www.topografix.com/GPX/1/1">',
  ];
  for (const segments of tracks) {
    lines.push('  <trk>');
    for (const segment of segments) {
      lines.push('    <trkseg>');
      for (const vertex of segment) lines.push(...trkptLines(vertex));
      lines.push('    </trkseg>');
    }
    lines.push('  </trk>');
  }
  lines.push('</gpx>', '');
  return lines.join('\n');
}
