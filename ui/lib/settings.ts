import { normalizeDimensions, validateRenderConfig } from '../../src/config.js';
import type {
  ConfigOverrides,
  HudSpec,
  RenderConfig,
  Style,
  View,
} from '../../src/config.js';

export function patchConfig(
  config: RenderConfig,
  patch: ConfigOverrides,
): RenderConfig | null {
  const next: RenderConfig = { ...config, ...patch, hud: patch.hud ?? config.hud };
  try {
    validateRenderConfig(next);
  } catch {
    return null;
  }
  return { ...next, ...normalizeDimensions(next.width, next.height) };
}

export function setHudChip(
  hud: HudSpec,
  chip: keyof HudSpec,
  on: boolean,
): HudSpec {
  const next = { ...hud };
  next[chip] = on;
  return next;
}

export const STYLE_LABELS: Record<Style, string> = {
  satellite: 'Satellite',
  topo: 'Topographic',
};

export const VIEW_LABELS: Record<View, string> = {
  follow: 'Follow',
  overview: 'Overview',
};
