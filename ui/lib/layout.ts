// Workspace geometry in px: the chrome heights and the map frame the two
// stage layouts give the map, mirrored from ui/app/globals.css so the gate
// and the warm plan can target what the map shows before it mounts. The
// literals here equal the CSS custom properties and fixed sizes of the
// workspace frame; change the two together.

import { clamp } from './clamp.js';

/** The review workspace's two stage layouts. */
export type StageLayout = 'split' | 'overlay';

/** Fixed chrome heights above and below the stage (globals.css); the rows sit
 * flush (no margins), so these heights cover the whole window. */
export const CHROME = {
  headerH: 56,
  transportH: 48,
  timelineH: 200,
  /** The timeline shrinks when the window is short (max-height: 720px). */
  timelineCompactH: 140,
  statusH: 32,
} as const;

/** Below this window height the timeline runs in its compact height. */
export const COMPACT_HEIGHT = 720;

/** The split layout's map rail: clamp(280px, 28%, 372px) of the stage. */
const RAIL_MIN = 280;
const RAIL_MAX = 372;
/** The stage's own padding, 16px on each edge: the rail's percent resolves
 * inside it horizontally, and the rail runs 32px shorter than the stage
 * vertically. */
const STAGE_PAD = 32;

/** The overlay layout's square map box: clamp(180px, 36% of the stage, 242px). */
const OVERLAY_MIN = 180;
const OVERLAY_MAX = 242;
const OVERLAY_SCALE = 0.36;

export function stageHeight(innerHeight: number): number {
  const timeline = innerHeight <= COMPACT_HEIGHT ? CHROME.timelineCompactH : CHROME.timelineH;
  return Math.max(0, innerHeight - CHROME.headerH - CHROME.transportH - timeline - CHROME.statusH);
}

/**
 * The frame the map fills, in px, for the given stage layout. Mirrors the
 * map rail's and the overlay card's sizing rules in ui/app/globals.css.
 */
export function mapFrameSize(
  innerWidth: number,
  innerHeight: number,
  layout: StageLayout,
): { width: number; height: number } {
  const height = stageHeight(innerHeight);
  if (layout === 'overlay') {
    const side = Math.round(clamp(height * OVERLAY_SCALE, OVERLAY_MIN, OVERLAY_MAX));
    return { width: side, height: side };
  }
  const rail = clamp(Math.round((innerWidth - STAGE_PAD) * 0.28), RAIL_MIN, RAIL_MAX);
  return {
    width: rail,
    height: Math.max(96, height - STAGE_PAD),
  };
}
