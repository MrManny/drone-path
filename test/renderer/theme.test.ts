import { describe, expect, it } from 'vitest';

import { themeFor } from '../../src/renderer/theme.js';

describe('themeFor', () => {
  it.for([
    { style: 'satellite', core: '#e87f54', vignette: 0.16 },
    { style: 'topo', core: '#e87f54', vignette: 0.06 },
  ] as const)('$style theme paints the shared trail core', ({ style, core, vignette }) => {
    const theme = themeFor(style);
    expect(theme.core).toBe(core);
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
});
