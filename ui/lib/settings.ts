import { DEFAULT_CONFIG, isValidRenderConfig, normalizeDimensions } from '../../src/config.js';
import type {
  AppearanceSettings,
  ConfigOverrides,
  HudLayout,
  RenderConfig,
  MapStyle,
  ViewMode,
} from '../../src/config.js';

export function patchConfig(
  config: RenderConfig,
  patch: ConfigOverrides,
): RenderConfig | null {
  const next: RenderConfig = { ...config, ...patch, hud: patch.hud ?? config.hud };
  if (!isValidRenderConfig(next)) return null;
  return { ...next, ...normalizeDimensions(next.width, next.height) };
}

export function setHudChip(
  hud: HudLayout,
  chip: keyof HudLayout,
  on: boolean,
): HudLayout {
  const next = { ...hud };
  next[chip] = on;
  return next;
}

export const STYLE_LABELS: Record<MapStyle, string> = {
  satellite: 'Satellite',
  topo: 'Topographic',
};

export const VIEW_LABELS: Record<ViewMode, string> = {
  follow: 'Follow',
  overview: 'Overview',
};

/** The map look settings Map appearance owns; Restore defaults resets only these. */
export function defaultAppearance(): AppearanceSettings {
  const { style, view, zoom, zoomOut, introSec, outroSec, trailColor, hud } = DEFAULT_CONFIG;
  return { style, view, zoom, zoomOut, introSec, outroSec, trailColor, hud: { ...hud } };
}
