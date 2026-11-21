import { bearingDeg, gpsFixOrNull, haversineM } from './geo.js';
import type { LatLon } from './geo.js';
import type { TrackRecord } from './track.js';

export const SHOT_TYPES = [
  'takeoff',
  'landing',
  'hover',
  'smooth-glide',
  'orbit',
  'gimbal-reveal',
  'reposition',
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

export interface KinematicShot {
  type: ShotType;
  startSec: number;
  endSec: number;
  durationSec: number;
  smoothness: number;
  exposureStable: boolean;
  meanSpeedMps: number;
  meanYawRateDegPerSec: number;
}

interface AnalysisWindow {
  startSec: number;
  endSec: number;
  centerSec: number;
  speedMps: number;
  signedAccelMps2: number;
  yawRateDegPerSec: number;
  signedGimbalPitchRate: number | null;
  signedGimbalYawRate: number | null;
  altRateMps: number | null;
  exposureStable: boolean;
  type: ShotType;
}

interface SegmentRun {
  type: ShotType;
  windows: AnalysisWindow[];
}

const MAX_INTERPOLATION_GAP_S = 3;
const EDGE_SNAP_GAP_S = 0.5;
const MIN_WINDOW_REMAINDER_S = 0.5;
const TERMINAL_PHASE_WINDOW_S = 15;
const EXPOSURE_REL_THRESHOLD = 0.25;
const EXPOSURE_CCT_THRESHOLD_K = 200;
const SHORT_CLIP_MAX_S = 4;
const BLIP_MAX_DURATION_S = 2;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function shortestAngleDiffDeg(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg + 540) % 360) + 360) % 360) - 180;
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function altitudeOf(record: TrackRecord): number | null {
  if (typeof record.altRel === 'number' && Number.isFinite(record.altRel)) return record.altRel;
  if (typeof record.altAbs === 'number' && Number.isFinite(record.altAbs)) return record.altAbs;
  if (typeof record.gpsAltMm === 'number' && Number.isFinite(record.gpsAltMm)) return record.gpsAltMm / 1000;
  return null;
}

function fixOf(record: TrackRecord): LatLon | null {
  return gpsFixOrNull(record.lat ?? null, record.lng ?? null);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function lowerBoundTime(records: readonly TrackRecord[], targetT: number): number {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (records[mid].tSec < targetT) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bracketValue<T>(
  records: readonly TrackRecord[],
  targetT: number,
  read: (record: TrackRecord) => T | null,
): { before: { tSec: number; value: T } | null; after: { tSec: number; value: T } | null } {
  const idx = lowerBoundTime(records, targetT);
  let before: { tSec: number; value: T } | null = null;
  for (let i = Math.min(idx, records.length - 1); i >= 0; i--) {
    if (records[i].tSec > targetT) continue;
    const value = read(records[i]);
    if (value !== null) {
      before = { tSec: records[i].tSec, value };
      break;
    }
  }
  let after: { tSec: number; value: T } | null = null;
  for (let i = idx; i < records.length; i++) {
    if (records[i].tSec < targetT) continue;
    const value = read(records[i]);
    if (value !== null) {
      after = { tSec: records[i].tSec, value };
      break;
    }
  }
  return { before, after };
}

function sampleFixAt(records: readonly TrackRecord[], targetT: number): LatLon | null {
  const { before, after } = bracketValue(records, targetT, fixOf);
  if (before && after) {
    if (before.tSec === targetT) return before.value;
    if (after.tSec === targetT) return after.value;
    const span = after.tSec - before.tSec;
    if (span <= MAX_INTERPOLATION_GAP_S && Math.abs(after.value.lon - before.value.lon) <= 180) {
      const fraction = (targetT - before.tSec) / span;
      return {
        lat: before.value.lat + (after.value.lat - before.value.lat) * fraction,
        lon: before.value.lon + (after.value.lon - before.value.lon) * fraction,
      };
    }
  }
  if (before && targetT - before.tSec <= EDGE_SNAP_GAP_S) return before.value;
  if (after && after.tSec - targetT <= EDGE_SNAP_GAP_S) return after.value;
  return null;
}

function sampleScalarAt(
  records: readonly TrackRecord[],
  targetT: number,
  read: (record: TrackRecord) => number | null,
): number | null {
  const { before, after } = bracketValue(records, targetT, read);
  if (before && after) {
    if (before.tSec === targetT) return before.value;
    if (after.tSec === targetT) return after.value;
    const span = after.tSec - before.tSec;
    if (span <= MAX_INTERPOLATION_GAP_S) {
      const fraction = (targetT - before.tSec) / span;
      return before.value + (after.value - before.value) * fraction;
    }
  }
  if (before && targetT - before.tSec <= EDGE_SNAP_GAP_S) return before.value;
  if (after && after.tSec - targetT <= EDGE_SNAP_GAP_S) return after.value;
  return null;
}

function sampleAngleAt(
  records: readonly TrackRecord[],
  targetT: number,
  read: (record: TrackRecord) => number | null,
): number | null {
  const { before, after } = bracketValue(records, targetT, read);
  if (before && after) {
    if (before.tSec === targetT) return normalizeDeg(before.value);
    if (after.tSec === targetT) return normalizeDeg(after.value);
    const span = after.tSec - before.tSec;
    if (span <= MAX_INTERPOLATION_GAP_S) {
      const fraction = (targetT - before.tSec) / span;
      return normalizeDeg(before.value + shortestAngleDiffDeg(before.value, after.value) * fraction);
    }
  }
  if (before && targetT - before.tSec <= EDGE_SNAP_GAP_S) return normalizeDeg(before.value);
  if (after && after.tSec - targetT <= EDGE_SNAP_GAP_S) return normalizeDeg(after.value);
  return null;
}

function buildWindowBounds(minT: number, maxT: number): { startSec: number; endSec: number }[] {
  const bounds: { startSec: number; endSec: number }[] = [];
  let cursor = minT;
  while (cursor < maxT) {
    const remaining = maxT - cursor;
    // Fold a tiny trailing sliver into the previous window so every window spans at least 0.5 s.
    if (remaining < MIN_WINDOW_REMAINDER_S && bounds.length > 0) {
      bounds[bounds.length - 1].endSec = maxT;
      break;
    }
    const endSec = Math.min(maxT, cursor + 1);
    bounds.push({ startSec: cursor, endSec });
    cursor = endSec;
  }
  return bounds;
}

function hasRelativeJump(a: number, b: number, threshold: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo <= 0) return hi !== lo;
  return (hi - lo) / lo > threshold;
}

function channelStable(
  samples: readonly (number | null)[],
  isJump: (a: number, b: number) => boolean,
): boolean {
  let prev: number | null = null;
  let min = Infinity;
  let max = -Infinity;
  for (const value of samples) {
    if (value === null) continue;
    if (prev !== null && isJump(prev, value)) return false;
    prev = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return !Number.isFinite(min) || !isJump(min, max);
}

function isWindowExposureStable(
  records: readonly TrackRecord[],
  wStart: number,
  wEnd: number,
): boolean {
  const firstIdx = lowerBoundTime(records, wStart);
  const slice: TrackRecord[] = [];
  // Include the immediately preceding sample so 1 Hz inter-cue jumps are caught in the window they occur.
  if (firstIdx > 0 && wStart - records[firstIdx - 1].tSec <= MAX_INTERPOLATION_GAP_S) {
    slice.push(records[firstIdx - 1]);
  }
  for (let i = firstIdx; i < records.length && records[i].tSec <= wEnd; i++) {
    slice.push(records[i]);
  }
  if (slice.length < 2) return true;

  const isoStable = channelStable(
    slice.map((r) => finiteOrNull(r.iso)),
    (a, b) => hasRelativeJump(a, b, EXPOSURE_REL_THRESHOLD),
  );
  const shutterStable = channelStable(
    slice.map((r) => finiteOrNull(r.shutterTime)),
    (a, b) => hasRelativeJump(a, b, EXPOSURE_REL_THRESHOLD),
  );
  const wbStable = channelStable(
    slice.map((r) => finiteOrNull(r.whiteBalanceCctK)),
    (a, b) => Math.abs(b - a) > EXPOSURE_CCT_THRESHOLD_K || hasRelativeJump(a, b, EXPOSURE_REL_THRESHOLD),
  );
  return isoStable && shutterStable && wbStable;
}

function classifyWindow(
  window: Omit<AnalysisWindow, 'type'>,
  minT: number,
  maxT: number,
): ShotType {
  const { speedMps, signedAccelMps2, yawRateDegPerSec, signedGimbalPitchRate, altRateMps, startSec, endSec } = window;
  const absAccel = Math.abs(signedAccelMps2);
  const absYawRate = Math.abs(yawRateDegPerSec);
  const absGimbalPitchRate = signedGimbalPitchRate === null ? null : Math.abs(signedGimbalPitchRate);
  const absAltRate = Math.abs(altRateMps ?? 0);

  if (endSec - minT <= TERMINAL_PHASE_WINDOW_S && altRateMps !== null && altRateMps >= 0.8) {
    return 'takeoff';
  }
  if (maxT - startSec <= TERMINAL_PHASE_WINDOW_S && altRateMps !== null && altRateMps <= -0.8) {
    return 'landing';
  }
  if (speedMps < 0.8 && absAltRate < 0.5 && (absGimbalPitchRate === null || absGimbalPitchRate < 3)) {
    return 'hover';
  }
  if (absGimbalPitchRate !== null && absGimbalPitchRate >= 4 && absAccel < 3) {
    return 'gimbal-reveal';
  }
  if (speedMps >= 1.0 && absYawRate >= 4 && absYawRate <= 45) {
    return 'orbit';
  }
  if (speedMps >= 1.0 && absYawRate < 4 && absAccel < 2.0 && absAltRate < 1.0) {
    return 'smooth-glide';
  }
  return 'reposition';
}

function buildWindows(records: readonly TrackRecord[], minT: number, maxT: number): AnalysisWindow[] {
  const bounds = buildWindowBounds(minT, maxT);
  const raw = bounds.map(({ startSec, endSec }) => {
    const dt = endSec - startSec;
    const fixStart = sampleFixAt(records, startSec);
    const fixMid = sampleFixAt(records, (startSec + endSec) / 2);
    const fixEnd = sampleFixAt(records, endSec);

    let speedMps = 0;
    if (fixStart && fixEnd) {
      const distM = fixMid
        ? haversineM(fixStart, fixMid) + haversineM(fixMid, fixEnd)
        : haversineM(fixStart, fixEnd);
      speedMps = distM / dt;
    }

    const altStart = sampleScalarAt(records, startSec, altitudeOf);
    const altEnd = sampleScalarAt(records, endSec, altitudeOf);
    const altRateMps = altStart !== null && altEnd !== null ? (altEnd - altStart) / dt : null;

    const yawStart = sampleAngleAt(records, startSec, (r) => finiteOrNull(r.yawDeg));
    const yawEnd = sampleAngleAt(records, endSec, (r) => finiteOrNull(r.yawDeg));
    const directYawRate = yawStart !== null && yawEnd !== null
      ? shortestAngleDiffDeg(yawStart, yawEnd) / dt
      : null;
    const cogHeading = fixStart && fixEnd && speedMps >= 0.5 ? bearingDeg(fixStart, fixEnd) : null;

    const gimbalPitchStart = sampleScalarAt(records, startSec, (r) => finiteOrNull(r.gimbalPitchDeg));
    const gimbalPitchEnd = sampleScalarAt(records, endSec, (r) => finiteOrNull(r.gimbalPitchDeg));
    const signedGimbalPitchRate = gimbalPitchStart !== null && gimbalPitchEnd !== null
      ? (gimbalPitchEnd - gimbalPitchStart) / dt
      : null;

    const gimbalYawStart = sampleAngleAt(records, startSec, (r) => finiteOrNull(r.gimbalYawDeg));
    const gimbalYawEnd = sampleAngleAt(records, endSec, (r) => finiteOrNull(r.gimbalYawDeg));
    const signedGimbalYawRate = gimbalYawStart !== null && gimbalYawEnd !== null
      ? shortestAngleDiffDeg(gimbalYawStart, gimbalYawEnd) / dt
      : null;

    return {
      startSec,
      endSec,
      centerSec: (startSec + endSec) / 2,
      speedMps,
      directYawRate,
      cogHeading,
      signedGimbalPitchRate,
      signedGimbalYawRate,
      altRateMps,
      exposureStable: isWindowExposureStable(records, startSec, endSec),
    };
  });

  return raw.map((w, i) => {
    let yawRateDegPerSec = w.directYawRate;
    if (yawRateDegPerSec === null) {
      const prev = i > 0 ? raw[i - 1] : undefined;
      const next = i === 0 ? raw[1] : undefined;
      if (prev && w.cogHeading !== null && prev.cogHeading !== null) {
        yawRateDegPerSec = shortestAngleDiffDeg(prev.cogHeading, w.cogHeading) /
          (w.centerSec - prev.centerSec);
      } else if (next && w.cogHeading !== null && next.cogHeading !== null) {
        yawRateDegPerSec = shortestAngleDiffDeg(w.cogHeading, next.cogHeading) /
          (next.centerSec - w.centerSec);
      } else {
        yawRateDegPerSec = 0;
      }
    }

    const signedAccelMps2 = i > 0
      ? (w.speedMps - raw[i - 1].speedMps) / (w.centerSec - raw[i - 1].centerSec)
      : 0;

    const partial: Omit<AnalysisWindow, 'type'> = {
      startSec: w.startSec,
      endSec: w.endSec,
      centerSec: w.centerSec,
      speedMps: w.speedMps,
      signedAccelMps2,
      yawRateDegPerSec,
      signedGimbalPitchRate: w.signedGimbalPitchRate,
      signedGimbalYawRate: w.signedGimbalYawRate,
      altRateMps: w.altRateMps,
      exposureStable: w.exposureStable,
    };
    return { ...partial, type: classifyWindow(partial, minT, maxT) };
  });
}

function runDuration(run: SegmentRun): number {
  return run.windows[run.windows.length - 1].endSec - run.windows[0].startSec;
}

function mergeSameTypeRuns(runs: SegmentRun[]): SegmentRun[] {
  const merged: SegmentRun[] = [];
  for (const run of runs) {
    const prev = merged.at(-1);
    if (prev && prev.type === run.type) {
      prev.windows.push(...run.windows);
    } else {
      merged.push({ type: run.type, windows: [...run.windows] });
    }
  }
  return merged;
}

function coalesceRuns(windows: readonly AnalysisWindow[], totalDuration: number): SegmentRun[] {
  let runs = mergeSameTypeRuns(windows.map((w) => ({ type: w.type, windows: [w] })));
  if (runs.length <= 1 || totalDuration < SHORT_CLIP_MAX_S) return runs;

  // Absorb transient <2 s blips into flanking runs when sandwiched by the same type,
  // or into the longer neighbor when not an intentional terminal takeoff/landing phase.
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (runDuration(run) >= BLIP_MAX_DURATION_S) continue;

      const prev = i > 0 ? runs[i - 1] : null;
      const next = i < runs.length - 1 ? runs[i + 1] : null;
      if (prev && next && prev.type === next.type) {
        prev.windows.push(...run.windows, ...next.windows);
        runs.splice(i, 2);
        changed = true;
        break;
      }

      const isTerminalPhase = (i === 0 && run.type === 'takeoff') || (i === runs.length - 1 && run.type === 'landing');
      if (isTerminalPhase) continue;

      if (prev && (!next || runDuration(prev) >= runDuration(next))) {
        prev.windows.push(...run.windows);
        runs.splice(i, 1);
      } else if (next) {
        next.windows.unshift(...run.windows);
        runs.splice(i, 1);
      }
      runs = mergeSameTypeRuns(runs);
      changed = true;
      break;
    }
  }
  return runs;
}

function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  return sq / values.length;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function computeSmoothness(windows: readonly AnalysisWindow[]): number {
  const accels = windows.map((w) => w.signedAccelMps2);
  const yawRates = windows.map((w) => w.yawRateDegPerSec);
  const gimbalPitches = windows.flatMap((w) => (w.signedGimbalPitchRate === null ? [] : [w.signedGimbalPitchRate]));
  const gimbalYaws = windows.flatMap((w) => (w.signedGimbalYawRate === null ? [] : [w.signedGimbalYawRate]));

  const accelVar = variance(accels);
  const meanAbsAccel = mean(accels.map(Math.abs));
  const yawVar = variance(yawRates);
  const excessYaw = Math.max(0, mean(yawRates.map(Math.abs)) - 45);
  const gimbalVar = variance(gimbalPitches) + variance(gimbalYaws);

  const penalty = accelVar / 4 + meanAbsAccel / 5 + yawVar / 100 + excessYaw / 30 + gimbalVar / 100;
  const score = Math.min(1, Math.max(0, Math.exp(-penalty)));
  return roundTo(score, 3);
}

/**
 * Classifies a clip's telemetry records into contiguous deterministic kinematic shot segments.
 */
export function segmentFlightShots(records: readonly TrackRecord[]): KinematicShot[] {
  const valid = records.filter((r) => Number.isFinite(r.tSec));
  if (valid.length < 2) return [];
  const sorted = [...valid].sort((a, b) => a.tSec - b.tSec);
  const minT = sorted[0].tSec;
  const maxT = sorted[sorted.length - 1].tSec;
  const totalDuration = maxT - minT;
  if (!Number.isFinite(totalDuration) || totalDuration < 1) return [];

  const windows = buildWindows(sorted, minT, maxT);
  if (windows.length === 0) return [];
  const runs = coalesceRuns(windows, totalDuration);

  return runs.map(({ type, windows: runWindows }) => {
    const startSec = roundTo(runWindows[0].startSec, 3);
    const endSec = roundTo(runWindows[runWindows.length - 1].endSec, 3);
    return {
      type,
      startSec,
      endSec,
      durationSec: roundTo(endSec - startSec, 3),
      smoothness: computeSmoothness(runWindows),
      exposureStable: runWindows.every((w) => w.exposureStable),
      meanSpeedMps: roundTo(mean(runWindows.map((w) => w.speedMps)), 2),
      meanYawRateDegPerSec: roundTo(mean(runWindows.map((w) => w.yawRateDegPerSec)), 2),
    };
  });
}
