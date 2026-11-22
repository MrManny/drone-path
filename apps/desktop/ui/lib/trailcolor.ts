import { tEnglish } from '../../shared/desktop-i18n/loader.js';
import type { Translate } from '../../shared/desktop-i18n/loader.js';
type TrailSwatchId = 'style-default' | 'coral' | 'white' | 'black' | 'custom';

interface TrailSwatch {
  id: TrailSwatchId;
  label: string;
  /** The trail color it stores; the style default stores null. */
  value: string | null;
}

/** The preset swatches; Custom… carries whatever hex the field holds. */
export function trailSwatches(t: Translate = tEnglish): readonly TrailSwatch[] {
  return [
    { id: 'style-default', label: t('trailcolor.styleDefault'), value: null },
    { id: 'coral', label: t('trailcolor.coral'), value: '#e87f54' },
    { id: 'white', label: t('trailcolor.white'), value: '#ffffff' },
    { id: 'black', label: t('trailcolor.black'), value: '#000000' },
  ];
}

export function customSwatch(t: Translate = tEnglish): TrailSwatch {
  return { id: 'custom', label: t('trailcolor.custom'), value: null };
}

const TRAIL_SWATCHES = trailSwatches();

/** Which swatch a stored trail color selects; anything unknown is custom. */
export function swatchIdFor(value: string | null): TrailSwatchId {
  if (value === null) return 'style-default';
  const lower = value.toLowerCase();
  for (const swatch of TRAIL_SWATCHES) {
    if (swatch.value !== null && swatch.value === lower) return swatch.id;
  }
  return 'custom';
}
