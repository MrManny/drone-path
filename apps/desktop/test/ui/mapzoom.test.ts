import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import { TILE_SOURCES } from 'drone-path-engine/renderer/tilesources';
import {
  normalizePinnedZoom,
  normalizeZoom,
  resetZoom,
  stepPinnedZoom,
} from '../../ui/lib/mapzoom.js';

describe('normalizePinnedZoom (#270)', () => {
  it.for<{ name: string; value: number; want: number }>([
    { name: 'keeps auto-fit at 0', value: 0, want: 0 },
    { name: 'treats a sub-level rounding to zero as auto-fit', value: 0.4, want: 0 },
    { name: 'keeps a usable level', value: 14, want: 14 },
    { name: 'rounds a fraction to the next level', value: 14.5, want: 15 },
    { name: 'clamps above the style maximum', value: 25, want: TILE_SOURCES.satellite.maxZoom },
    { name: 'clamps below the floor', value: 1, want: 2 },
    { name: 'clamps a negative to auto-fit', value: -3, want: 0 },
  ])('$name', ({ value, want }) => {
    expect(normalizePinnedZoom(value, 'satellite')).toBe(want);
  });
});

describe('stepPinnedZoom (#270)', () => {
  it.for<{ name: string; visibleZoom: number; delta: 1 | -1; want: number }>([
    { name: 'steps one level in', visibleZoom: 15, delta: 1, want: 16 },
    { name: 'steps one level out', visibleZoom: 15, delta: -1, want: 14 },
    {
      name: 'resolves auto-fit to the visible level on the first step in',
      visibleZoom: 15,
      delta: 1,
      want: 16,
    },
    {
      name: 'resolves auto-fit with zoom-out from the visible level',
      visibleZoom: 12,
      delta: 1,
      want: 13,
    },
    { name: 'lands on the style maximum', visibleZoom: 18, delta: 1, want: 19 },
    { name: 'lands on the floor', visibleZoom: 3, delta: -1, want: 2 },
  ])('$name', ({ visibleZoom, delta, want }) => {
    expect(stepPinnedZoom(visibleZoom, delta, 'satellite')).toBe(want);
  });

  it.for<{ name: string; visibleZoom: number; delta: 1 | -1 }>([
    { name: 'in from the maximum', visibleZoom: 19, delta: 1 },
    { name: 'out from the minimum', visibleZoom: 2, delta: -1 },
  ])('offers no step $name', ({ visibleZoom, delta }) => {
    expect(stepPinnedZoom(visibleZoom, delta, 'satellite')).toBeNull();
  });
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

describe('normalizeZoom (#271)', () => {
  it('normalizes a stale stored zoom to one usable level', () => {
    expect(normalizeZoom({ ...DEFAULT_CONFIG, zoom: 25 }).zoom).toBe(
      TILE_SOURCES.satellite.maxZoom,
    );
  });

  it('keeps the config identical when the pin is already a level', () => {
    const config = { ...DEFAULT_CONFIG, zoom: 14 };
    expect(normalizeZoom(config)).toBe(config);
    const auto = { ...DEFAULT_CONFIG, zoom: 0 };
    expect(normalizeZoom(auto)).toBe(auto);
  });
});
