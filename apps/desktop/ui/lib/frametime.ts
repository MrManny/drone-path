import { tEnglish } from '../../src/desktop-i18n/messages.js';
import type { Translate } from '../../src/desktop-i18n/messages.js';
import { timeAt } from 'drone-path-core/frametime';
import type { LoopPoints, LoopState } from './loop.js';
import { hasLoop } from './loop.js';

export { framesForSeconds } from 'drone-path-core/frametime';

// requestVideoFrameCallback quantizes mediaTime to the microsecond, so the
// product can land just under frame i's integer; the slack covers that error
// in frame units but stays below half a frame.
const QUANTIZATION_SLACK_SEC = 1.25e-6;

export function frameFromMediaTime(mediaTime: number, fps: number, frames: number): number {
  return clampFrame(Math.floor((mediaTime + QUANTIZATION_SLACK_SEC) * fps), frames);
}

export function clampFrame(i: number, frames: number): number {
  return Math.max(0, Math.min(frames - 1, i));
}

// Explicit seeks land half a frame into frame i's span: an exact i / fps can
// fall under frame i's PTS and settle the previous frame (#92).
export function frameMidTime(frame: number, fps: number): number {
  return (frame + 0.5) / fps;
}

export function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return Math.floor(total / 60) + ':' + ('0' + (total % 60)).slice(-2);
}

export function formatTimeReadout(frame: number, fps: number, durationSec: number): string {
  return `${formatTime(timeAt(frame, fps))} / ${formatTime(durationSec)}`;
}

function formatPoint(f: number, fps: number): string {
  return formatTime(timeAt(f, fps));
}

export function formatFrameSpan(start: number, end: number, fps: number): string {
  return `${formatPoint(start, fps)}–${formatPoint(end, fps)}`;
}

export function formatFrameRange(points: LoopPoints, fps: number, t: Translate = tEnglish): string {
  return t('frametime.range', { span: formatFrameSpan(points.in, points.out, fps), count: points.out - points.in + 1 });
}

// The readout names the passage the band shows (#245): a lone point reads to
// the clip boundary, so the label and the visualization never disagree.
export function formatLoopReadout(loop: LoopState, fps: number, maxFrame: number, t: Translate = tEnglish): string {
  return hasLoop(loop)
    ? t('frametime.loop', { start: formatPoint(loop.in ?? 0, fps), end: formatPoint(loop.out ?? maxFrame, fps) })
    : '';
}

const TICK_STEPS_SEC = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];

export function timelineTicks(durationSec: number): number[] {
  if (!(durationSec > 0)) return [];
  const step = TICK_STEPS_SEC.find((s) => durationSec / s <= 6) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t < durationSec; t += step) ticks.push(t);
  const last = Math.round(durationSec);
  if (ticks[ticks.length - 1] !== last) ticks.push(last);
  return ticks;
}
