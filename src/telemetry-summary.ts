import type {
  HeadingMode,
  Telemetry,
  TelemetryMethod,
  TelemetrySource,
} from './telemetry-math.js';

export interface TelemetrySummary {
  source: TelemetrySource;
  method: TelemetryMethod;
  headingMode: HeadingMode;
  fixCount: number;
  noLock: number;
  trackDistanceM: number;
}

export function telemetrySummary(tel: Telemetry): TelemetrySummary {
  return {
    source: tel.source,
    method: tel.method,
    headingMode: tel.headingMode,
    fixCount: tel.fixCount,
    noLock: tel.noLock,
    trackDistanceM: Math.round(tel.trackDistanceM),
  };
}

export function fixCountLabel(fixCount: number): string {
  return `${fixCount} fixes`;
}

export function noLockCountLabel(noLock: number): string {
  return `${noLock} no-lock cues`;
}

export function trackDistanceLabel(trackDistanceM: number): string {
  return `${trackDistanceM} m`;
}
