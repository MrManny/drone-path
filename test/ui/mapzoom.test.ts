import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/config.js';
import { zoomLimits } from '../../src/plan.js';
import { resetZoom, stepPinnedZoom } from '../../ui/lib/mapzoom.js';

interface StepCase {
  name: string;
  zoom: number;
  visibleZoom: number;
  delta: 1 | -1;
  want: number;
}

describe('stepPinnedZoom (#270)', () => {
  it.for<StepCase>([
    {
      name: 'the first press out of auto-fit pins one level in',
      zoom: 0,
      visibleZoom: 15,
      delta: 1,
      want: 16,
    },
    {
      name: 'the first press out of auto-fit pins one level out',
      zoom: 0,
      visibleZoom: 15,
      delta: -1,
      want: 14,
    },
    { name: 'a pinned level steps on', zoom: 16, visibleZoom: 16, delta: 1, want: 17 },
    { name: 'a pinned level steps back', zoom: 16, visibleZoom: 16, delta: -1, want: 15 },
    {
      name: 'auto-fit with zoom-out resolves from the visible level',
      zoom: 0,
      visibleZoom: 12,
      delta: 1,
      want: 13,
    },
    {
      name: 'an out-of-range pin re-pins from the visible level',
      zoom: 25,
      visibleZoom: 19,
      delta: -1,
      want: 18,
    },
    {
      name: 'the step lands on the style maximum',
      zoom: 18,
      visibleZoom: 18,
      delta: 1,
      want: 19,
    },
    { name: 'the step lands on the floor', zoom: 3, visibleZoom: 3, delta: -1, want: 2 },
  ])('$name', ({ zoom, visibleZoom, delta, want }) => {
    expect(stepPinnedZoom({ zoom, visibleZoom }, delta, 'satellite')).toBe(want);
  });

  it.for<{ name: string; zoom: number; visibleZoom: number; delta: 1 | -1 }>([
    { name: 'in from the maximum', zoom: 19, visibleZoom: 19, delta: 1 },
    { name: 'out from the minimum', zoom: 2, visibleZoom: 2, delta: -1 },
    { name: 'out from auto-fit at the minimum', zoom: 0, visibleZoom: 2, delta: -1 },
    { name: 'in from auto-fit at the maximum', zoom: 0, visibleZoom: 19, delta: 1 },
    { name: 'in from an out-of-range pin at the maximum', zoom: 25, visibleZoom: 19, delta: 1 },
  ])('offers no step $name', ({ zoom, visibleZoom, delta }) => {
    expect(stepPinnedZoom({ zoom, visibleZoom }, delta, 'satellite')).toBeNull();
  });
});

describe('zoomLimits (#270)', () => {
  it.for(['satellite', 'topo'] as const)(
    '%s clamps between the floor and the tile maximum',
    (style) => {
      const limits = zoomLimits(style);
      expect(limits.min).toBe(2);
      expect(limits.max).toBeGreaterThanOrEqual(limits.min);
    },
  );
});

describe('resetZoom (#270)', () => {
  it('resets a pinned zoom to auto-fit', () => {
    expect(resetZoom({ ...DEFAULT_CONFIG, zoom: 12 }).zoom).toBe(0);
  });

  it('keeps the config identical at auto-fit', () => {
    const config = { ...DEFAULT_CONFIG, zoom: 0 };
    expect(resetZoom(config)).toBe(config);
  });
});
