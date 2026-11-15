import { describe, expect, it } from 'vitest';

import type { SceneData } from '../../src/renderer/scene.js';
import { chipReadoutsAt, formatChipValue } from '../../ui/lib/chipreadouts.js';

type Channels = Pick<SceneData, 'alt' | 'speed' | 'headingDeg'>;

const CHANNELS: Channels = {
  alt: [10, 11.4, null],
  speed: [null, 2.56, 3.14],
  headingDeg: [0, 90, 180],
};

describe('chipReadoutsAt', () => {
  it('reads the values at the frame', () => {
    expect(chipReadoutsAt(CHANNELS, 1)).toEqual({ headingDeg: 90, alt: 11.4, speed: 2.56 });
  });

  it('keeps a missing sample missing', () => {
    expect(chipReadoutsAt(CHANNELS, 2)).toEqual({ headingDeg: 180, alt: null, speed: 3.14 });
    expect(chipReadoutsAt(CHANNELS, 0)).toEqual({ headingDeg: 0, alt: 10, speed: null });
  });

  it('clamps an out-of-range frame to the nearest sample', () => {
    expect(chipReadoutsAt(CHANNELS, -5)).toEqual(chipReadoutsAt(CHANNELS, 0));
    expect(chipReadoutsAt(CHANNELS, 99)).toEqual(chipReadoutsAt(CHANNELS, 2));
    expect(chipReadoutsAt(CHANNELS, 1.4)).toEqual(chipReadoutsAt(CHANNELS, 1));
  });
});

describe('formatChipValue', () => {
  it('formats like the renderer: whole meters, one speed decimal', () => {
    expect(formatChipValue('alt', chipReadoutsAt(CHANNELS, 1))).toBe('11');
    expect(formatChipValue('speed', chipReadoutsAt(CHANNELS, 1))).toBe('2.6');
    expect(formatChipValue('speed', chipReadoutsAt(CHANNELS, 2))).toBe('3.1');
  });

  it('shows the dimmed placeholder for a missing value', () => {
    expect(formatChipValue('alt', chipReadoutsAt(CHANNELS, 2))).toBe('--');
    expect(formatChipValue('speed', chipReadoutsAt(CHANNELS, 0))).toBe('--');
    expect(formatChipValue('heading', { headingDeg: null, alt: null, speed: null })).toBe('--');
  });

  it('leaves the heading to the arrow glyph', () => {
    expect(formatChipValue('heading', chipReadoutsAt(CHANNELS, 1))).toBe('');
  });
});
