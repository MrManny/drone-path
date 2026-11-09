import type { RecordingSummary } from '../../src/run.js';
import { formatFrameRate } from './framerate.js';

export function formatExportSummary(summary: RecordingSummary): string {
  const rate = summary.fps ? ` @ ${formatFrameRate(summary.fps)}` : '';
  return (
    `${summary.frames} frames${rate} · ${Math.round(summary.elapsedSec)} s · ` +
    `${summary.width}×${summary.height}`
  );
}
