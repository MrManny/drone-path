// The loading copy of the Open flow: the notice names the running preparation
// stage and counts the tiles during the map pre-warm (design guidelines §8.6).
import type { PrepareProgress } from '../../src/run.js';

export function prepareNoticeText(progress: PrepareProgress): string {
  switch (progress.stage) {
    case 'probe':
      return 'Probing the recording…';
    case 'telemetry':
      return 'Loading telemetry…';
    case 'plan':
      return 'Planning the view…';
    case 'tiles':
      return `Warming tiles… ${progress.tilesDone}/${progress.tilesTotal}`;
  }
}

// The bar must never shrink mid-load, but done/total does: the total grows
// when the view plan reveals the tile count (3/3 becomes 3/84). So the stages
// before the pre-warm hold their checkpoints — the step ratio their events
// carry while the tile count is still unknown (0/3, 1/3, 2/3 → 0/33/67%) —
// and the pre-warm fills the rest of the bar tile by tile to 100%. Percent is
// presentation; the wire keeps counting raw steps (PrepareProgress, src/run.ts).
const PLAN_PERCENT = 67;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function preparePercent(progress: PrepareProgress): number {
  switch (progress.stage) {
    case 'probe':
      return 0;
    case 'telemetry':
      return 33;
    case 'plan':
      return PLAN_PERCENT;
    case 'tiles': {
      // A plan without tiles leaves nothing to warm, so the bar is complete.
      const share = clamp01(
        progress.tilesTotal > 0 ? progress.tilesDone / progress.tilesTotal : 1,
      );
      return Math.round(PLAN_PERCENT + (100 - PLAN_PERCENT) * share);
    }
    default:
      // A stage this mapping does not know (a newer pipeline across the IPC)
      // falls back to the wire's raw step ratio, clamped to keep the bar
      // within 0-100.
      return Math.round(
        100 * clamp01(progress.total > 0 ? progress.done / progress.total : 0),
      );
  }
}
