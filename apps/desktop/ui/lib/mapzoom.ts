import type { MapStyle, RenderConfig } from 'drone-path-engine/config';
import { zoomLimits } from 'drone-path-engine/plan';

/** What the zoom stepper needs from the settings side; the map card knows the visible level. */
export interface ZoomControls {
  zoom: number;
  style: MapStyle;
  onStep: (delta: 1 | -1) => void;
  /** Announcement for a refused step at a limit; the stepper carries it to screen readers. */
  notice?: string;
}

/**
 * The "Zoom" setting as one whole planner level: 0 stays auto-fit, anything
 * else rounds and clamps to the style's usable levels. Field entry, stored
 * settings and the exported level all pass through here so they cannot
 * disagree (#270).
 */
export function normalizePinnedZoom(value: number, style: MapStyle): number {
  const { min, max } = zoomLimits(style);
  const level = Math.round(value);
  if (level <= 0) return 0;
  return Math.min(max, Math.max(min, level));
}

/** The values the Zoom field accepts: auto-fit or one whole usable level. */
export function isZoomPinValue(value: number, style: MapStyle): boolean {
  return value === normalizePinnedZoom(value, style);
}

/**
 * Steps one zoom level from the visible one and returns the level to pin, or
 * null at a planner limit where no step is possible. Basing the step on the
 * visible level resolves auto-fit to that level ± 1 on the first press.
 */
export function stepPinnedZoom(
  visibleZoom: number,
  delta: 1 | -1,
  style: MapStyle,
): number | null {
  const target = normalizePinnedZoom(visibleZoom + delta, style);
  return target === visibleZoom ? null : target;
}

/** Opening a recording always starts back at auto-fit (#270). */
export function resetZoom(config: RenderConfig): RenderConfig {
  return config.zoom === 0 ? config : { ...config, zoom: 0 };
}

/** Stored settings may predate the field rule; normalize them once on load. */
export function normalizeZoom(config: RenderConfig): RenderConfig {
  const zoom = normalizePinnedZoom(config.zoom, config.style);
  return zoom === config.zoom ? config : { ...config, zoom };
}
