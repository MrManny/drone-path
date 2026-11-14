// The flight track model the pure serializers consume: vertices at decoded
// GPS fixes, telemetry gaps breaking the line, absolute/GPS altitude, and a
// time only where the source carries trustworthy UTC. Built from the same
// per-source-frame records as the telemetry JSON document, so the CLI and the
// desktop app export byte-identical tracks for the same records.

import type { TelemetryFrameInput } from './telemetry-json.js';

export interface TrackVertex {
  lat: number;
  lon: number;
  /** Absolute/GPS altitude in meters above mean sea level; null when unknown. */
  altM: number | null;
  /** Epoch milliseconds, trustworthy UTC only; null when unknown. */
  timeMs: number | null;
}

export type TrackSegment = TrackVertex[];

// Time policy: a vertex carries a time only where the source provides
// trustworthy UTC. Neither telemetry source does, measured against real
// footage: the DVTM gimbal device timestamp is milliseconds since power-up
// (34229 ms at clip start, spanning the clip - not an epoch), and the .SRT cue
// wall-clock has no time zone. A relative or zone-less clock is never exported
// as UTC, so no times appear anywhere today. A future source with real UTC
// epoch milliseconds turns on times here and nowhere else.
function timeOf(row: TelemetryFrameInput): number | null {
  void row;
  return null;
}

function altitudeOf(row: TelemetryFrameInput): number | null {
  if (row.altAbs !== null && row.altAbs !== undefined) return row.altAbs;
  if (row.gpsAltMm !== null && row.gpsAltMm !== undefined) return row.gpsAltMm / 1000;
  return null;
}

function vertexOf(row: TelemetryFrameInput): TrackVertex {
  return {
    lat: row.lat as number,
    lon: row.lng as number,
    altM: altitudeOf(row),
    timeMs: timeOf(row),
  };
}

/**
 * Splits decoded records into track segments: one vertex per record with a
 * GPS fix, a new segment after every run of records without one. Nothing is
 * interpolated or bridged across a gap.
 */
export function buildTrack(rows: readonly TelemetryFrameInput[]): TrackSegment[] {
  const segments: TrackSegment[] = [];
  let current: TrackSegment = [];
  for (const row of rows) {
    const fixed =
      row.lat !== null && row.lat !== undefined && row.lng !== null && row.lng !== undefined;
    if (!fixed) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(vertexOf(row));
  }
  if (current.length > 0) segments.push(current);
  return segments;
}
