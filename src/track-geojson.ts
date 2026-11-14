// Pure GeoJSON serializer (RFC 7946): one MultiLineString line per track
// segment, [lon, lat] or [lon, lat, altM] positions, and the QGIS
// coordinateProperties.times convention only where every vertex carries
// trustworthy UTC. Assembled with fixed formatting and key order, so identical
// input yields identical bytes.

import { isoUtc } from './track.js';
import type { TrackSegment, TrackVertex } from './track.js';

function position(vertex: TrackVertex): string {
  return vertex.altM !== null
    ? `[${vertex.lon}, ${vertex.lat}, ${vertex.altM}]`
    : `[${vertex.lon}, ${vertex.lat}]`;
}

function oneLineList(items: readonly string[]): string {
  return items.length > 0 ? `[${items.join(', ')}]` : '[]';
}

function itemLines(indents: string, itemsBySegment: readonly string[][]): string[] {
  const lines: string[] = [];
  itemsBySegment.forEach((items, index) => {
    const last = index === itemsBySegment.length - 1;
    lines.push(`${indents}${oneLineList(items)}${last ? '' : ','}`);
  });
  return lines;
}

export function serializeGeoJson(segments: readonly TrackSegment[]): string {
  const allTimed =
    segments.length > 0 &&
    segments.every((segment) => segment.every((vertex) => vertex.timeMs !== null));
  const lines: string[] = [
    '{',
    '  "type": "Feature",',
    '  "geometry": {',
    '    "type": "MultiLineString",',
    '    "coordinates": [',
  ];
  lines.push(...itemLines('      ', segments.map((s) => s.map(position))));
  lines.push('    ]', '  },');
  if (allTimed) {
    lines.push('  "properties": {', '    "coordinateProperties": {', '      "times": [');
    lines.push(
      ...itemLines(
        '        ',
        segments.map((segment) =>
          segment.map((vertex) => JSON.stringify(isoUtc(vertex.timeMs as number))),
        ),
      ),
    );
    lines.push('      ]', '    }', '  }', '}', '');
  } else {
    lines.push('  "properties": {}', '}', '');
  }
  return lines.join('\n');
}
