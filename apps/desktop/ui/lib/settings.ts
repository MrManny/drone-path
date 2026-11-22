import type { Translate } from '../../shared/desktop-i18n/loader.js';
import { DEFAULT_CONFIG, appearanceOf, isValidRenderConfig, normalizeDimensions } from 'drone-path-engine/config';
import type {
  AppearanceSettings,
  ConfigOverrides,
  HudLayout,
  RenderConfig,
  MapStyle,
  ViewMode,
} from 'drone-path-engine/config';

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

export function styleLabels(t: Translate): Record<MapStyle, string> {
  return {
    satellite: t('settings.satellite'),
    topo: t('settings.topographic'),
  };
}

export function viewLabels(t: Translate): Record<ViewMode, string> {
  return {
    follow: t('settings.follow'),
    overview: t('settings.overview'),
  };
}

/** The map look settings Map appearance owns; Restore defaults resets only these. */
export function defaultAppearance(): AppearanceSettings {
  return appearanceOf(DEFAULT_CONFIG);
}
