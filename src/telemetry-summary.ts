import type { Telemetry } from './telemetry-math.js';

export type TelemetrySummary = Pick<
  Telemetry,
  'source' | 'method' | 'headingMode' | 'fixCount' | 'noLock' | 'trackDistanceM'
>;

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
