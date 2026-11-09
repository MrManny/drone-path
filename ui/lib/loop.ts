export interface LoopPoints {
  in: number;
  out: number;
}

export interface LoopState {
  in: number | null;
  out: number | null;
}

export function engagedLoop(state: LoopState): LoopPoints | null {
  return state.in !== null && state.out !== null && state.in < state.out
    ? { in: state.in, out: state.out }
    : null;
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
