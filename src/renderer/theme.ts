// Per-style renderer colors. One mapping so the generated page and the app's
// map island can never drift apart. The trail core is the palette accent (#147)
// unless a trail color replaces it; the glow and the casing are then derived
// from the chosen color so the layered trail stays readable on both styles.

import type { Style } from '../config.js';

export interface Theme {
  /** The scene accent (drone marker, start dot, HUD chips): always solid. */
  core: string;
  /** The trail core stroke: the chosen color verbatim, RGBA alpha honored. */
  trailCore: string;
  glow: string;
  casing: string;
  ghost: string;
  ghostOpacity: number;
  ghostCasing: string | null;
  discBg: string;
  vignette: number;
}

/** The flight-trail color: the palette accent, one color everywhere. */
const TRAIL_COLOR = '#e87f54';

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

// The canonical form the option vocabulary hands over: #rrggbb or #rrggbbaa.
function parseHexColor(hex: string): Rgb {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
  if (!m) throw new Error(`invalid trail color: ${hex}`);
  const [r, g, b, a] = [0, 2, 4, 6].map((i) =>
    i < m[1].length ? Number.parseInt(m[1].slice(i, i + 2), 16) : 255,
  );
  return { r, g, b, a: a / 255 };
}

// Four decimals keep every derived color string deterministic.
function rgba(c: Rgb, alpha: number): string {
  return `rgba(${c.r},${c.g},${c.b},${Math.round(alpha * 10000) / 10000})`;
}

// WCAG relative luminance, the readability rule's measure of "how light".
function luminance(c: Rgb): number {
  const linear = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

function mix(base: Rgb, tint: Rgb, amount: number): Rgb {
  const k = (x: number, y: number): number => Math.round(x + (y - x) * amount);
  return { r: k(base.r, tint.r), g: k(base.g, tint.g), b: k(base.b, tint.b), a: 1 };
}

// The casing is the contrast anchor under the core stroke: the style's proven
// neutral, tinted toward the chosen color so it follows it, flipped to the
// opposite neutral when the core sits too close to the anchor to separate the
// trail from it.
const CASING_ANCHORS: Record<
  Style,
  { anchor: Rgb; opposite: Rgb; alpha: number }
> = {
  satellite: {
    anchor: { r: 10, g: 14, b: 20, a: 1 },
    opposite: { r: 255, g: 255, b: 255, a: 1 },
    alpha: 0.9,
  },
  topo: {
    anchor: { r: 255, g: 255, b: 255, a: 1 },
    opposite: { r: 10, g: 14, b: 20, a: 1 },
    alpha: 1,
  },
};

const CONTRAST_FLIP = 0.18;
const CORE_TINT = 0.2;

function deriveCasing(style: Style, core: Rgb): string {
  const { anchor, opposite, alpha } = CASING_ANCHORS[style];
  const base =
    Math.abs(luminance(core) - luminance(anchor)) < CONTRAST_FLIP ? opposite : anchor;
  return rgba(mix(base, core, CORE_TINT), alpha);
}

const GLOW_ALPHA: Record<Style, number> = { satellite: 0.32, topo: 0.26 };

function trailGlow(alpha: number): string {
  return rgba(parseHexColor(TRAIL_COLOR), alpha);
}

const THEMES: Record<Style, Theme> = {
  satellite: {
    core: TRAIL_COLOR,
    trailCore: TRAIL_COLOR,
    glow: trailGlow(GLOW_ALPHA.satellite),
    casing: 'rgba(10,14,20,0.9)',
    ghost: '#ffffff',
    ghostOpacity: 0.85,
    ghostCasing: 'rgba(8,12,18,0.55)',
    discBg: 'rgba(10,14,20,0.82)',
    vignette: 0.16,
  },
  topo: {
    core: TRAIL_COLOR,
    trailCore: TRAIL_COLOR,
    glow: trailGlow(GLOW_ALPHA.topo),
    casing: '#ffffff',
    ghost: '#6b6252',
    ghostOpacity: 0.7,
    ghostCasing: 'rgba(255,255,255,0.8)',
    discBg: 'rgba(26,22,18,0.85)',
    vignette: 0.06,
  },
};

export function themeFor(style: Style, trailColor: string | null = null): Theme {
  const base = THEMES[style];
  if (trailColor === null) return base;
  const core = parseHexColor(trailColor);
  return {
    ...base,
    core: rgba(core, 1),
    trailCore: trailColor,
    glow: rgba(core, GLOW_ALPHA[style] * core.a),
    casing: deriveCasing(style, core),
  };
}
