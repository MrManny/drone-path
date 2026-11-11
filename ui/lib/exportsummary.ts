import { formatFps } from '../../src/frametime.js';
import type { RecordingSummary } from '../../src/run.js';

export function formatExportSummary(summary: RecordingSummary): string {
  const rate = summary.fps ? ` @ ${formatFps(summary.fps)}` : '';
  return (
    `${summary.frames} frames${rate} · ${Math.round(summary.elapsedSec)} s · ` +
    `${summary.width}×${summary.height}`
  );
}
