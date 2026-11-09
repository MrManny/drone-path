import { describe, expect, it } from 'vitest';

import { themeFor } from '../../src/renderer/theme.js';

describe('themeFor', () => {
  it.for([
    { style: 'satellite', core: '#e87f54', vignette: 0.16 },
    { style: 'topo', core: '#e87f54', vignette: 0.06 },
  ] as const)('$style theme paints the shared trail core', ({ style, core, vignette }) => {
    const theme = themeFor(style);
    expect(theme.core).toBe(core);
    expect(theme.trailCore).toBe(core);
    expect(theme.vignette).toBe(vignette);
  });

  it.for(['satellite', 'topo'] as const)('%s theme is complete', (style) => {
    const theme = themeFor(style);
    expect(theme.glow).toBeTruthy();
    expect(theme.casing).toBeTruthy();
    expect(theme.ghost).toBeTruthy();
    expect(theme.ghostOpacity).toBeGreaterThan(0);
    expect(theme.discBg).toBeTruthy();
  });

  it('keeps the per-style defaults when no trail color is chosen', () => {
    expect(themeFor('satellite').glow).toBe('rgba(232,127,84,0.32)');
    expect(themeFor('satellite').casing).toBe('rgba(10,14,20,0.9)');
    expect(themeFor('topo').glow).toBe('rgba(232,127,84,0.26)');
    expect(themeFor('topo').casing).toBe('#ffffff');
    expect(themeFor('satellite', null)).toBe(themeFor('satellite'));
  });

  it.for([
    {
      style: 'satellite',
      trailColor: '#41f0ff',
      core: 'rgba(65,240,255,1)',
      glow: 'rgba(65,240,255,0.32)',
      casing: 'rgba(21,59,67,0.9)',
    },
    {
      style: 'topo',
      trailColor: '#e63946',
      core: 'rgba(230,57,70,1)',
      glow: 'rgba(230,57,70,0.26)',
      casing: 'rgba(250,215,218,1)',
    },
    {
      style: 'satellite',
      trailColor: '#41f0ff80',
      core: 'rgba(65,240,255,1)',
      glow: 'rgba(65,240,255,0.1606)',
      casing: 'rgba(21,59,67,0.9)',
    },
  ] as const)(
    'derives $style glow and casing from $trailColor',
    ({ style, trailColor, core, glow, casing }) => {
      const theme = themeFor(style, trailColor);
      expect(theme.trailCore).toBe(trailColor);
      expect(theme.core).toBe(core);
      expect(theme.glow).toBe(glow);
      expect(theme.casing).toBe(casing);
    },
  );

  it.for([
    { style: 'topo', trailColor: '#ffffff', casing: 'rgba(59,62,67,1)' },
    { style: 'satellite', trailColor: '#000000', casing: 'rgba(204,204,204,0.9)' },
  ] as const)(
    'flips the casing anchor when $trailColor would blend into $style',
    ({ style, trailColor, casing }) => {
      expect(themeFor(style, trailColor).casing).toBe(casing);
    },
  );
});
