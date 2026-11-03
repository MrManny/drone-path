import { describe, expect, it } from 'vitest';

import {
  GATE_TILE_COUNT,
  computeOverview,
  displayedTiles,
  gateTiles,
  planIntroOutroFrames,
} from '../src/plan.js';
import type { TileCoord } from '../src/plan.js';
import type { Bbox, LatLon } from '../src/geo.js';
import { unproject } from '../src/geo.js';

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
    // ~0.1 m span: the >=80 px rule pulls the camera out to the zoom-16 floor.
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

describe('gateTiles', () => {
  // A 5x5 plan grid at one tile zoom, the way tilesCovering hands them over.
  const GRID: TileCoord[] = [];
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) GRID.push({ z: 5, x, y });
  }
  const centerOf = (x: number, y: number): LatLon => unproject(x * 256 + 128, y * 256 + 128, 5);
  const keys = (tiles: TileCoord[]): string[] => tiles.map((t) => `${t.x}/${t.y}`).sort();

  it('covers the pane window the first frame shows', () => {
    // 512x256 of map px around the drone's tile: 5 columns x 3 rows with
    // the one-tile slack, a superset of the drone's own 3x3.
    const gate = gateTiles(GRID, centerOf(2, 2), { width: 512, height: 256 });
    expect(keys(gate)).toEqual([
      '0/1', '0/2', '0/3', '1/1', '1/2', '1/3', '2/1', '2/2', '2/3',
      '3/1', '3/2', '3/3', '4/1', '4/2', '4/3',
    ]);
  });

  it('keeps the drone tile and its 8 neighbors as a floor', () => {
    // The window centers on the map's own view far from the drone: the
    // neighborhood still joins it (overview centers on the track).
    const gate = gateTiles(GRID, centerOf(4, 4), { width: 256, height: 256 }, centerOf(0, 0));
    expect(keys(gate)).toEqual([
      '0/0', '0/1', '1/0', '1/1', '2/2', '2/3', '2/4', '3/2', '3/3',
      '3/4', '4/2', '4/3', '4/4',
    ]);
  });

  it('clips the neighborhood to the plan at its edges', () => {
    const gate = gateTiles(GRID, centerOf(0, 0), { width: 256, height: 256 });
    expect(keys(gate)).toEqual([
      '0/0', '0/1', '0/2', '1/0', '1/1', '1/2', '2/0', '2/1', '2/2',
    ]);
  });

  it('keeps plan order', () => {
    const gate = gateTiles(GRID, centerOf(2, 2), { width: 512, height: 256 });
    const order = gate.map((t) => GRID.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  describe.for([
    { name: 'none', count: 0 },
    { name: 'one', count: 1 },
    { name: 'five', count: 5 },
    { name: 'exactly the floor', count: GATE_TILE_COUNT },
  ])('a plan of $name tiles', ({ count }) => {
    it('warms the whole plan, leaving nothing to stream later', () => {
      const plan = GRID.slice(0, count);
      expect(gateTiles(plan, centerOf(2, 2), { width: 512, height: 512 })).toEqual(plan);
    });
  });
});

describe('displayedTiles', () => {
  const BBOX: Bbox = {
    minLat: 46.6129,
    maxLat: 46.6132,
    minLon: 14.2622,
    maxLon: 14.2626,
  };

  it('covers the map element the app lays out: twice the pane plus the slide', () => {
    const frame = { width: 480, height: 270 };
    const tiles = displayedTiles(BBOX, 15, frame, { style: 'satellite', view: 'follow' });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.z === 15)).toBe(true);
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    // 2x the pane plus one tile of slack covers a small window of the plan,
    // and a bigger frame covers strictly more.
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBeLessThanOrEqual(8);
    expect(Math.max(...ys) - Math.min(...ys) + 1).toBeLessThanOrEqual(7);
    const larger = displayedTiles(BBOX, 15, { width: 960, height: 540 }, {
      style: 'satellite',
      view: 'follow',
    });
    expect(tiles.length).toBeLessThan(larger.length);
  });

  it('follows the zoom it is given, never re-fitting', () => {
    const shallow = displayedTiles(BBOX, 14, { width: 480, height: 270 }, {
      style: 'satellite',
      view: 'overview',
    });
    const deep = displayedTiles(BBOX, 16, { width: 480, height: 270 }, {
      style: 'satellite',
      view: 'overview',
    });
    expect(shallow.every((t) => t.z === 14)).toBe(true);
    expect(deep.every((t) => t.z === 16)).toBe(true);
    expect(deep.length).toBeGreaterThanOrEqual(shallow.length);
  });
});
