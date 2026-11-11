import { bearingDeg, circularMeanDeg, haversineM } from './geo.js';
import type { Bbox, LatLon } from './geo.js';
import type { CamMetaMethod } from './cammeta.js';

export type TelemetrySource = 'srt' | 'cammeta';
export type TelemetryMethod = 'srt-cues' | CamMetaMethod;
export type HeadingMode = 'yaw' | 'cog';

// The parallel-array view of the per-frame values, shared by the pipeline,
// the page model and the scene wire format (which keeps these key names).
export interface FrameChannels {
  lat: number[];
  lon: number[];
  alt: (number | null)[];
  speed: (number | null)[];
  headingDeg: number[];
}

interface FrameData {
  fix: LatLon | null;
  alt: number | null;
  speed: number | null;
  headingDeg: number;
}

export interface Telemetry {
  source: TelemetrySource;
  method: TelemetryMethod;
  headingMode: HeadingMode;
  sampleCount: number;
  fixCount: number;
  noLock: number;
  frames: FrameData[];
  bbox: Bbox;
  trackDistanceM: number;
}

export interface TelSample {
  tSec: number;
  fix: LatLon | null;
  relAlt: number | null;
  absAlt: number | null;
  yawDeg: number | null;
}

export interface TelemetrySamples {
  samples: TelSample[];
  source: TelemetrySource;
  method: TelemetryMethod;
  noLock: number;
}

interface FramePosition {
  fix: LatLon | null;
  alt: number | null;
}

type FixSample = TelSample & { fix: LatLon };

type FixRef = FixSample & { index: number };

const MAX_INTERPOLATION_GAP_S = 3;
const SPEED_SMOOTHING_SPAN = 5;
const HEADING_MIN_MOVE_M = 1.5;
const HEADING_HALF_WINDOW_S = 0.35;
const HEADING_MAX_BASELINE_S = 3;
const HEADING_MIN_SPEED_MPS = 0.5;
const HEADING_SMOOTHING_SPAN = 4;

function isFixSample(sample: TelSample): sample is FixSample {
  return sample.fix !== null;
}

function fixRefs(samples: TelSample[]): FixRef[] {
  const refs: FixRef[] = [];
  samples.forEach((sample, index) => {
    if (isFixSample(sample)) refs.push({ ...sample, index });
  });
  return refs;
}

function altitudeOf(sample: TelSample): number | null {
  return sample.relAlt ?? sample.absAlt ?? null;
}

function positionOfSample(sample: TelSample): FramePosition {
  return { fix: sample.fix, alt: altitudeOf(sample) };
}

function interpolateAltitude(
  a: TelSample,
  b: TelSample,
  fraction: number,
): number | null {
  const altA = altitudeOf(a);
  const altB = altitudeOf(b);
  if (altA === null) return altB;
  if (altB === null) return altA;
  return altA + (altB - altA) * fraction;
}

function nearestFix(
  samples: TelSample[],
  idx: number,
  direction: number,
): FixSample | null {
  let i = idx;
  while (i >= 0 && i < samples.length) {
    const sample = samples[i];
    if (isFixSample(sample)) return sample;
    i += direction;
  }
  return null;
}

function positionAt(
  samples: TelSample[],
  t: number,
  maxGapSec = MAX_INTERPOLATION_GAP_S,
): FramePosition {
  const n = samples.length;
  if (n === 0) return { fix: null, alt: null };
  if (t <= samples[0].tSec) return positionOfSample(samples[0]);
  if (t >= samples[n - 1].tSec) return positionOfSample(samples[n - 1]);

  const lo = sampleIndexBefore(samples, t);
  const hi = lo + 1;
  const a = nearestFix(samples, lo, -1);
  const b = nearestFix(samples, hi, 1);
  if (a !== null && b === null) return positionOfSample(a);
  if (a === null && b !== null) return positionOfSample(b);
  if (a === null || b === null) return { fix: null, alt: null };

  const dt = b.tSec - a.tSec;
  const gapOk = dt > 0 && dt <= maxGapSec;
  const fraction = gapOk ? (t - a.tSec) / dt : 0;
  return {
    fix: {
      lat: a.fix.lat + (b.fix.lat - a.fix.lat) * fraction,
      lon: a.fix.lon + (b.fix.lon - a.fix.lon) * fraction,
    },
    alt: interpolateAltitude(a, b, fraction),
  };
}

function sampleIndexBefore(samples: TelSample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].tSec <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

function nearestSampleIndex(samples: TelSample[], t: number): number {
  const lo = sampleIndexBefore(samples, t);
  const hi = Math.min(lo + 1, samples.length - 1);
  return t - samples[lo].tSec <= samples[hi].tSec - t ? lo : hi;
}

function computeTrackStats(
  fixes: FixRef[],
): { bbox: Bbox; trackDistanceM: number } {
  const bbox: Bbox = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLon: Infinity,
    maxLon: -Infinity,
  };
  let trackDistanceM = 0;
  let prev: LatLon | null = null;
  for (const { fix } of fixes) {
    bbox.minLat = Math.min(bbox.minLat, fix.lat);
    bbox.maxLat = Math.max(bbox.maxLat, fix.lat);
    bbox.minLon = Math.min(bbox.minLon, fix.lon);
    bbox.maxLon = Math.max(bbox.maxLon, fix.lon);
    if (prev !== null) {
      trackDistanceM += haversineM(prev, fix);
    }
    prev = fix;
  }
  return { bbox, trackDistanceM };
}

function computeSpeedBySample(
  sampleCount: number,
  fixes: FixRef[],
): number[] {
  const rawSpeed: (number | null)[] = new Array(fixes.length).fill(null);
  for (let k = 1; k < fixes.length - 1; k++) {
    const dt = fixes[k + 1].tSec - fixes[k - 1].tSec;
    if (dt > 0.001) {
      rawSpeed[k] = haversineM(fixes[k - 1].fix, fixes[k + 1].fix) / dt;
    }
  }
  rawSpeed[0] = rawSpeed[1] ?? 0;
  rawSpeed[fixes.length - 1] = rawSpeed[fixes.length - 2] ?? 0;

  const speedBySample = new Array<number>(sampleCount).fill(0);
  for (let k = 0; k < fixes.length; k++) {
    const lo = Math.max(0, k - SPEED_SMOOTHING_SPAN);
    const hi = Math.min(fixes.length - 1, k + SPEED_SMOOTHING_SPAN);
    let sum = 0;
    let count = 0;
    for (let j = lo; j <= hi; j++) {
      const v = rawSpeed[j];
      if (v !== null) {
        sum += v;
        count++;
      }
    }
    speedBySample[fixes[k].index] = count ? sum / count : 0;
  }
  return speedBySample;
}

interface HeadingResult {
  headingBySample: number[];
  headingMode: HeadingMode;
}

function computeHeadingBySample(
  samples: TelSample[],
  fixes: FixRef[],
  speedBySample: number[],
): HeadingResult {
  const hasYaw = samples.some((sample) => sample.yawDeg !== null);
  const headingMode: HeadingMode = hasYaw ? 'yaw' : 'cog';

  const rawHeading: (number | null)[] = new Array(fixes.length).fill(null);
  if (hasYaw) {
    fillYawHeadings(fixes, rawHeading);
  } else {
    fillCourseOverGroundHeadings(fixes, speedBySample, rawHeading);
  }
  fillHeadingGaps(rawHeading);

  const defaultHeading = rawHeading[0] ?? firstKnownHeading(rawHeading) ?? 0;
  const headingBySample = new Array<number>(samples.length).fill(defaultHeading);
  for (let k = 0; k < fixes.length; k++) {
    const lo = Math.max(0, k - HEADING_SMOOTHING_SPAN);
    const hi = Math.min(fixes.length - 1, k + HEADING_SMOOTHING_SPAN);
    const window: number[] = [];
    for (let j = lo; j <= hi; j++) {
      window.push(rawHeading[j] ?? defaultHeading);
    }
    headingBySample[fixes[k].index] = circularMeanDeg(window);
  }
  return { headingBySample, headingMode };
}

function fillYawHeadings(
  fixes: FixRef[],
  rawHeading: (number | null)[],
): void {
  for (let k = 0; k < fixes.length; k++) {
    const yaw = fixes[k].yawDeg;
    if (yaw !== null && Number.isFinite(yaw)) rawHeading[k] = ((yaw % 360) + 360) % 360;
  }
}

function fillCourseOverGroundHeadings(
  fixes: FixRef[],
  speedBySample: number[],
  rawHeading: (number | null)[],
): void {
  for (let k = 0; k < fixes.length; k++) {
    const tk = fixes[k].tSec;
    if ((speedBySample[fixes[k].index] ?? 0) < HEADING_MIN_SPEED_MPS) continue;
    let ka = k;
    let kb = k;
    let displacement = 0;
    for (const half of [HEADING_HALF_WINDOW_S, HEADING_MAX_BASELINE_S]) {
      ka = k;
      kb = k;
      while (ka > 0 && fixes[ka].tSec > tk - half) ka--;
      while (kb < fixes.length - 1 && fixes[kb].tSec < tk + half) kb++;
      displacement = haversineM(fixes[ka].fix, fixes[kb].fix);
      if (displacement >= HEADING_MIN_MOVE_M) break;
    }
    if (displacement >= HEADING_MIN_MOVE_M) {
      rawHeading[k] = bearingDeg(fixes[ka].fix, fixes[kb].fix);
    }
  }
}

function fillHeadingGaps(rawHeading: (number | null)[]): void {
  let last: number | null = null;
  for (let k = 0; k < rawHeading.length; k++) {
    if (rawHeading[k] !== null) last = rawHeading[k];
    else rawHeading[k] = last;
  }
  const fallback = firstKnownHeading(rawHeading) ?? 0;
  for (let k = 0; k < rawHeading.length; k++) {
    rawHeading[k] ??= fallback;
  }
}

function firstKnownHeading(rawHeading: (number | null)[]): number | null {
  for (const heading of rawHeading) {
    if (heading !== null) return heading;
  }
  return null;
}

function buildFrameData(
  samples: TelSample[],
  frames: number,
  fpsValue: number,
  speedBySample: number[],
  headingBySample: number[],
): FrameData[] {
  const frameData: FrameData[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / fpsValue;
    const pos = positionAt(samples, t);
    const si = nearestSampleIndex(samples, t);
    frameData.push({
      fix: pos.fix,
      alt: pos.alt,
      speed: Math.round(speedBySample[si] * 10) / 10,
      headingDeg: Math.round(headingBySample[si] * 10) / 10,
    });
  }
  return frameData;
}

function bridgeMissingFramePositions(frameData: FrameData[]): void {
  const first = frameData.find((d) => d.fix !== null);
  const last = [...frameData].reverse().find((d) => d.fix !== null);
  if (!first || !last) return;
  let lead = 0;
  while (lead < frameData.length && frameData[lead].fix === null) {
    frameData[lead].fix = first.fix;
    lead++;
  }
  let trail = frameData.length - 1;
  while (trail >= lead && frameData[trail].fix === null) {
    frameData[trail].fix = last.fix;
    trail--;
  }
}

export function buildTelemetry(
  loaded: TelemetrySamples,
  timing: { frames: number; fpsValue: number },
): Telemetry {
  const { samples, source, method, noLock } = loaded;
  const fixes = fixRefs(samples);
  if (fixes.length < 2) throw new Error('telemetry has fewer than 2 GPS fixes');

  const { bbox, trackDistanceM } = computeTrackStats(fixes);
  const speedBySample = computeSpeedBySample(samples.length, fixes);
  const { headingBySample, headingMode } = computeHeadingBySample(
    samples,
    fixes,
    speedBySample,
  );

  const frameData = buildFrameData(
    samples,
    timing.frames,
    timing.fpsValue,
    speedBySample,
    headingBySample,
  );
  bridgeMissingFramePositions(frameData);

  return {
    source,
    method,
    headingMode,
    sampleCount: samples.length,
    fixCount: fixes.length,
    noLock,
    frames: frameData,
    bbox,
    trackDistanceM,
  };
}
