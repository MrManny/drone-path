import { describe, expect, it } from 'vitest';

import { computeOverview, planIntroOutroFrames, planView, zoomLimits } from '../src/plan.js';
import type { Bbox } from '../src/geo.js';
import { TILE_SOURCES } from '../src/renderer/tilesources.js';

const BBOX: Bbox = {
  minLat: 46.6129,
  maxLat: 46.6132,
  minLon: 14.2622,
  maxLon: 14.2626,
};

describe('computeOverview', () => {
  it('auto-fits a small track inside the frame', () => {
    const r = computeOverview({ bbox: BBOX, width: 768, height: 768 });
    expect(r.zoom).toBeGreaterThanOrEqual(2);
    expect(r.zoom).toBeLessThanOrEqual(19);
    expect(r.tiles.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.centerPx.x)).toBe(true);
    expect(Number.isFinite(r.centerPx.y)).toBe(true);
  });

  it('clamps hover-scale spans at zoom 16 for a useful close-up', () => {
    const hover: Bbox = {
      minLat: 46.6130705,
      maxLat: 46.61307051,
      minLon: 14.2623885,
      maxLon: 14.26238851,
    };
    const r = computeOverview({ bbox: hover, width: 768, height: 768 });
    expect(r.zoom).toBe(16);
    expect(r.tiles.length).toBeGreaterThan(0);
  });

  it('honors a fixed zoom override', () => {
    const r = computeOverview({
      bbox: BBOX,
      width: 768,
      height: 768,
      zoomOverride: 15,
    });
    expect(r.zoom).toBe(15);
  });

  it('pulls the camera back with zoomOut', () => {
    const base = computeOverview({ bbox: BBOX, width: 768, height: 768 });
    const out = computeOverview({
      bbox: BBOX,
      width: 768,
      height: 768,
      zoomOut: 2,
    });
    expect(out.zoom).toBeLessThanOrEqual(base.zoom);
  });

  it('fetches topo tiles at the native zoom level when zoomed in', () => {
    const r = computeOverview({
      bbox: BBOX,
      width: 768,
      height: 768,
      zoomOverride: 18,
      maxNativeZoom: 17,
    });
    expect(r.zoom).toBe(18);
    expect(r.tiles.every((t) => t.z === 17)).toBe(true);
  });
});

describe('zoomLimits (#270)', () => {
  it.for(['satellite', 'topo'] as const)(
    '%s zooms between the floor and the tile maximum',
    (style) => {
      const limits = zoomLimits(style);
      expect(limits.min).toBe(2);
      expect(limits.max).toBe(TILE_SOURCES[style].maxZoom);
    },
  );

  it('is the clamp planView applies to a fixed zoom', () => {
    const { min, max } = zoomLimits('satellite');
    const over = planView(BBOX, 768, 768, {
      style: 'satellite',
      view: 'overview',
      zoom: max + 6,
      zoomOut: 0,
    });
    const under = planView(BBOX, 768, 768, {
      style: 'satellite',
      view: 'overview',
      zoom: 1,
      zoomOut: 0,
    });
    expect(over.zoom).toBe(max);
    expect(under.zoom).toBe(min);
  });

  it('renders a pinned zoom at the same level at any output size (#270)', () => {
    const config = { style: 'satellite', view: 'overview', zoom: 14, zoomOut: 0 } as const;
    const preview = planView(BBOX, 768, 768, config);
    const output = planView(BBOX, 1920, 1080, config);
    expect(preview.zoom).toBe(14);
    expect(output.zoom).toBe(preview.zoom);
  });
});

describe.for([
  {
    name: 'maps seconds to frames at the source rate',
    config: { introSec: 2, outroSec: 3 },
    source: { fps: 30, frames: 3000 },
    want: { introN: 60, outroN: 90, clamped: false },
  },
  {
    name: 'accepts a zero intro and outro',
    config: { introSec: 0, outroSec: 0 },
    source: { fps: 24, frames: 100 },
    want: { introN: 0, outroN: 0, clamped: false },
  },
  {
    name: 'rounds fractional frame rates',
    config: { introSec: 1, outroSec: 0 },
    source: { fps: 29.97, frames: 9000 },
    want: { introN: 30, outroN: 0, clamped: false },
  },
])('planIntroOutroFrames: $name', ({ config, source, want }) => {
  it('plans the frame counts', () => {
    expect(planIntroOutroFrames(config, source)).toEqual(want);
  });
});

describe('planIntroOutroFrames clamping', () => {
  it('shortens intro and outro for a very short clip and flags it', () => {
    const r = planIntroOutroFrames(
      { introSec: 2, outroSec: 2 },
      { fps: 30, frames: 60 },
    );
    expect(r).toEqual({ introN: 15, outroN: 15, clamped: true });
  });

  it('keeps tiny clips playable with a two-frame budget', () => {
    const r = planIntroOutroFrames(
      { introSec: 2, outroSec: 2 },
      { fps: 30, frames: 3 },
    );
    expect(r.clamped).toBe(true);
    expect(r.introN + r.outroN).toBeLessThanOrEqual(2);
    expect(r.introN).toBeGreaterThanOrEqual(0);
    expect(r.outroN).toBeGreaterThanOrEqual(0);
  });
});
