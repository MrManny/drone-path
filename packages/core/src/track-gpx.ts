// Pure GPX 1.1 serializer: one <trkseg> per track segment, altitude as <ele>,
// and a <time> only where the vertex carries trustworthy UTC. No metadata
// wall-clock or version strings, so identical input yields identical bytes.

import { isoUtc } from './track.js';
import type { TrackSegment, TrackVertex } from './track.js';

function trkptLines(vertex: TrackVertex): string[] {
  const children: string[] = [];
  if (vertex.altM !== null) children.push(`<ele>${vertex.altM}</ele>`);
  if (vertex.timeMs !== null) children.push(`<time>${isoUtc(vertex.timeMs)}</time>`);
  const open = `<trkpt lat="${vertex.lat}" lon="${vertex.lon}">`;
  if (children.length === 0) return [`      <trkpt lat="${vertex.lat}" lon="${vertex.lon}"/>`];
  return [
    `      ${open}`,
    ...children.map((child) => `        ${child}`),
    '      </trkpt>',
  ];
}

export function serializeGpx(segments: readonly TrackSegment[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="drone-path" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <trk>',
  ];
  for (const segment of segments) {
    lines.push('    <trkseg>');
    for (const vertex of segment) lines.push(...trkptLines(vertex));
    lines.push('    </trkseg>');
  }
  lines.push('  </trk>', '</gpx>', '');
  return lines.join('\n');
}
