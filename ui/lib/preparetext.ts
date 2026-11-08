// The loading copy of the Open flow: the notice names the running preparation
// stage and its bar shows the loading progress (design guidelines §8.6).
import type { PrepareProgress } from '../../src/run.js';

export function prepareNoticeText(progress: PrepareProgress): string {
  switch (progress.stage) {
    case 'probe':
      return 'Probing the recording…';
    case 'telemetry':
      return 'Loading telemetry…';
    case 'plan':
      return 'Planning the view…';
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Percent is presentation; the wire counts raw steps (PrepareProgress,
// src/run.ts). The total never changes mid-load, so the bar cannot shrink.
export function preparePercent(progress: PrepareProgress): number {
  return Math.round(
    100 * clamp01(progress.total > 0 ? progress.done / progress.total : 0),
  );
}
