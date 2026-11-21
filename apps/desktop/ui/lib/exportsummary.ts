import { tEnglish } from '../../src/desktop-i18n/messages.js';
import type { Translate } from '../../src/desktop-i18n/messages.js';
import { formatFps, parseRate } from 'drone-path-core/frametime';
import type { RecordingSummary } from 'drone-path-engine/pipeline';

// The spec line reads as media specs only: the encode wall time between them
// would read as a wrong media duration (#284).
function mediaSeconds(frames: number | undefined, fps: string | undefined): number | null {
  const rate = fps ? parseRate(fps) : null;
  const den = rate?.den ?? 1;
  if (!frames || !rate || !(rate.num > 0) || !(den > 0)) return null;
  return (frames * den) / rate.num;
}

export function formatExportSummary(summary: RecordingSummary, t: Translate = tEnglish): string {
  const rate = summary.fps ? ` @ ${formatFps(summary.fps)}` : '';
  const seconds = mediaSeconds(summary.frames, summary.fps);
  const duration = seconds === null ? '' : ` · ${seconds < 1 ? t('exportsummary.underSecond') : t('exportsummary.seconds', { duration: Math.round(seconds) })}`;
  return t('exportsummary.specs', { count: summary.frames ?? 'undefined', rate, duration, width: String(summary.width), height: String(summary.height) });
}
