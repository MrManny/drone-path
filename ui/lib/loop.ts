// Loop region state as pure data: one engagement rule the band, the readout,
// the playback wrap and the export segment all derive from.

export interface LoopPoints {
  /** First frame of the loop region, inclusive. */
  in: number;
  /** Last frame of the loop region, inclusive; playback wraps past it. */
  out: number;
}

export interface LoopState {
  /** Loop start frame, or null while unset. */
  in: number | null;
  /** Loop end frame, or null while unset. */
  out: number | null;
}

// The one engagement rule for loop regions: both ends set and ordered.
// Out-of-order pairs stay dormant until the second point lands inside the
// region. Everything (band, readout, wrap) derives from this.
export function engagedLoop(state: LoopState): LoopPoints | null {
  return state.in !== null && state.out !== null && state.in < state.out
    ? { in: state.in, out: state.out }
    : null;
}

/** Whether any point is set at all; unlike engagement, a half-marked loop counts. */
export function hasLoop(state: LoopState): boolean {
  return state.in !== null || state.out !== null;
}

/**
 * The frame a dragged loop handle may land on: clamped to the frame range
 * and kept strictly inside the other point when one is set, so a drag can
 * never disorder or empty an engaged loop.
 */
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
