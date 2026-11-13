import type { PrepareProgress } from '../../src/pipeline.js';

export function prepareNoticeText(progress: PrepareProgress): string {
  switch (progress.stage) {
    case 'probe':
      return 'Reading the recording…';
    case 'telemetry':
      return 'Loading telemetry…';
    case 'plan':
      return 'Setting up the map…';
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function preparePercent(progress: PrepareProgress): number {
  return Math.round(
    100 * clamp01(progress.total > 0 ? progress.done / progress.total : 0),
  );
}
