// Per-style renderer colors. One mapping so the generated page and the app's
// map island can never drift apart. The trail core is shared across styles so
// every flight trail wears the one palette accent (#147).

import type { Style } from '../config.js';

export interface Theme {
  core: string;
  glow: string;
  casing: string;
  ghost: string;
  ghostOpacity: number;
  ghostCasing: string | null;
  discBg: string;
  vignette: number;
}

/** The flight-trail color: the palette accent, one color everywhere. */
export const TRAIL_COLOR = '#e87f54';

function trailGlow(alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(TRAIL_COLOR.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

const THEMES: Record<Style, Theme> = {
  satellite: {
    core: TRAIL_COLOR,
    glow: trailGlow(0.32),
    casing: 'rgba(10,14,20,0.9)',
    ghost: '#ffffff',
    ghostOpacity: 0.85,
    ghostCasing: 'rgba(8,12,18,0.55)',
    discBg: 'rgba(10,14,20,0.82)',
    vignette: 0.16,
  },
  topo: {
    core: TRAIL_COLOR,
    glow: trailGlow(0.26),
    casing: '#ffffff',
    ghost: '#6b6252',
    ghostOpacity: 0.7,
    ghostCasing: 'rgba(255,255,255,0.8)',
    discBg: 'rgba(26,22,18,0.85)',
    vignette: 0.06,
  },
};

export function themeFor(style: Style): Theme {
  return THEMES[style];
}
