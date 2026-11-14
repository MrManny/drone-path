import type { FrameRange } from '../../src/config.js';

export interface LoopPoints {
  in: number;
  out: number;
}

export interface LoopState {
  in: number | null;
  out: number | null;
}

// The loop band is half-open: a lone in point runs to the end of the track
// and a lone out point from its start (#245); a crossed pair is a dead state
// that stays inert because markLoopPoint keeps it unreachable from the UI.
export function resolveLoop(state: LoopState, maxFrame: number): LoopPoints | null {
  const lo = state.in;
  const hi = state.out;
  if (lo !== null && hi !== null) return lo < hi ? { in: lo, out: hi } : null;
  if (lo !== null) return { in: lo, out: maxFrame };
  if (hi !== null) return { in: 0, out: hi };
  return null;
}

/** The export-request shape of a resolved loop: in/out become start/end. */
export function frameRangeOf(points: LoopPoints): FrameRange {
  return { start: points.in, end: points.out };
}

// Setting a point past the other supersedes the stale one (the same frame
// counts as past) so in < out holds in every state the UI can reach (#245).
export function markLoopPoint(state: LoopState, which: 'in' | 'out', frame: number): LoopState {
  if (which === 'in') {
    return state.out !== null && frame >= state.out
      ? { in: frame, out: null }
      : { in: frame, out: state.out };
  }
  return state.in !== null && frame <= state.in
    ? { in: null, out: frame }
    : { in: state.in, out: frame };
}

export function hasLoop(state: LoopState): boolean {
  return state.in !== null || state.out !== null;
}

export function clampHandleFrame(
  which: 'in' | 'out',
  frame: number,
  state: LoopState,
  maxFrame: number,
): number {
  const lo = which === 'out' && state.in !== null ? state.in + 1 : 0;
  const hi = which === 'in' && state.out !== null ? state.out - 1 : maxFrame;
  return Math.max(0, Math.min(maxFrame, Math.max(lo, Math.min(hi, frame))));
}

export function frameAtPointer(
  clientX: number,
  rect: { left: number; width: number },
  maxFrame: number,
): number {
  const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  return Math.max(0, Math.min(maxFrame, Math.round(ratio * maxFrame)));
}
