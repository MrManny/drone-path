// Workspace geometry in px: the chrome heights and the map frame the two
// stage layouts give the map, mirrored from ui/app/globals.css so the gate
// and the warm plan can target what the map shows before it mounts. The
// literals here equal the CSS custom properties and fixed sizes of the
// workspace frame; change the two together.

/** The review workspace's two stage layouts. */
export type StageLayout = 'split' | 'overlay';

/** Fixed chrome heights above and below the stage (globals.css). */
export const CHROME = {
  headerH: 56,
  previewStripH: 40,
  transportH: 48,
  timelineH: 200,
  /** The timeline shrinks when the window is short (max-height: 720px). */
  timelineCompactH: 140,
  statusH: 32,
} as const;

/** Below this window height the timeline runs in its compact height. */
export const COMPACT_HEIGHT = 720;

/** The split layout's map rail: clamp(280px, 28%, 372px) of the stage. */
export const RAIL_MIN = 280;
export const RAIL_MAX = 372;
/** The stage's own side padding: the rail's percent resolves inside it. */
export const STAGE_PAD = 32;
/** Card padding and borders around the map host inside the rail. */
export const RAIL_PAD = 34;
/** Header, position readout, note, paddings and gaps the rail adds around the map. */
export const RAIL_CHROME = 170;

/** The overlay layout's square map box: clamp(160px, 30% of the stage, 242px). */
export const OVERLAY_MIN = 160;
export const OVERLAY_MAX = 242;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function stageHeight(innerHeight: number): number {
  const timeline = innerHeight <= COMPACT_HEIGHT ? CHROME.timelineCompactH : CHROME.timelineH;
  return Math.max(
    0,
    innerHeight - CHROME.headerH - CHROME.previewStripH - CHROME.transportH - timeline - CHROME.statusH,
  );
}

/**
 * The frame the map fills, in px, for the given stage layout. Mirrors the
 * `.map-host` sizing rules of ui/app/globals.css.
 */
export function mapFrameSize(
  innerWidth: number,
  innerHeight: number,
  layout: StageLayout,
): { width: number; height: number } {
  const height = stageHeight(innerHeight);
  if (layout === 'overlay') {
    const side = Math.round(clamp(height * 0.3, OVERLAY_MIN, OVERLAY_MAX));
    return { width: side, height: side };
  }
  const rail = clamp(Math.round((innerWidth - STAGE_PAD) * 0.28), RAIL_MIN, RAIL_MAX);
  return {
    width: rail - RAIL_PAD,
    height: Math.max(96, height - RAIL_CHROME),
  };
}
