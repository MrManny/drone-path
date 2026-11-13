import { timeAt } from '../../src/frametime.js';
import type { LoopPoints, LoopState } from './loop.js';
import { hasLoop } from './loop.js';

export { framesForSeconds } from '../../src/frametime.js';

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

export function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return Math.floor(total / 60) + ':' + ('0' + (total % 60)).slice(-2);
}

export function formatTimeReadout(frame: number, fps: number, durationSec: number): string {
  return `${formatTime(timeAt(frame, fps))} / ${formatTime(durationSec)}`;
}

// A missing endpoint reads as "…" so a partial point says what is not set
// yet instead of asking a bare question.
export function formatPoint(f: number | null, fps: number): string {
  return f === null ? '…' : formatTime(timeAt(f, fps));
}

export function formatFrameSpan(
  start: number | null,
  end: number | null,
  fps: number,
): string {
  return `${formatPoint(start, fps)}–${formatPoint(end, fps)}`;
}

export function formatFrameRange(points: LoopPoints, fps: number): string {
  return `${formatFrameSpan(points.in, points.out, fps)} · ${points.out - points.in + 1} frames`;
}

export function formatLoopReadout(loop: LoopState, fps: number): string {
  return hasLoop(loop) ? `in ${formatPoint(loop.in, fps)} · out ${formatPoint(loop.out, fps)}` : '';
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
