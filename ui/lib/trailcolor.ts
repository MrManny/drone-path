type TrailSwatchId = 'style-default' | 'coral' | 'white' | 'black' | 'custom';

interface TrailSwatch {
  id: TrailSwatchId;
  label: string;
  /** The trail color it stores; the style default stores null. */
  value: string | null;
}

/** The preset swatches; Custom… carries whatever hex the field holds. */
export const TRAIL_SWATCHES: readonly TrailSwatch[] = [
  { id: 'style-default', label: 'Style default', value: null },
  { id: 'coral', label: 'Coral', value: '#e87f54' },
  { id: 'white', label: 'White', value: '#ffffff' },
  { id: 'black', label: 'Black', value: '#000000' },
];

export const CUSTOM_SWATCH: TrailSwatch = { id: 'custom', label: 'Custom…', value: null };

/** Which swatch a stored trail color selects; anything unknown is custom. */
export function swatchIdFor(value: string | null): TrailSwatchId {
  if (value === null) return 'style-default';
  const lower = value.toLowerCase();
  for (const swatch of TRAIL_SWATCHES) {
    if (swatch.value !== null && swatch.value === lower) return swatch.id;
  }
  return 'custom';
}
