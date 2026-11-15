import type { MapStyle, RenderConfig } from '../../src/config.js';
import { zoomLimits } from '../../src/plan.js';

export interface ZoomPinState {
  /** The pinned "Zoom" setting: 0 is auto-fit. */
  zoom: number;
  /** The level the map currently shows, as planned for the preview. */
  visibleZoom: number;
}

/** What the zoom pill needs from the settings side; the map card knows the visible level. */
export interface ZoomControls {
  zoom: number;
  style: MapStyle;
  onStep: (delta: 1 | -1) => void;
}

/**
 * Steps one zoom level and pins it as the fixed "Zoom" setting. The step is
 * based on the visible level, so the first press out of auto-fit resolves to
 * that level ± 1. Returns the new pinned level, or null at a planner limit
 * where no step is possible.
 */
export function stepPinnedZoom(
  state: ZoomPinState,
  delta: 1 | -1,
  style: MapStyle,
): number | null {
  const { min, max } = zoomLimits(style);
  const target = Math.min(max, Math.max(min, state.visibleZoom + delta));
  return target === state.visibleZoom ? null : target;
}

/** Opening a recording always starts back at auto-fit (#270). */
export function resetZoom(config: RenderConfig): RenderConfig {
  return config.zoom === 0 ? config : { ...config, zoom: 0 };
}
