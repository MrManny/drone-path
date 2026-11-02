import { describe, expect, it } from 'vitest';

import { createTrailController, lastIndexAtOrBefore } from '../../src/renderer/trail.js';
import type { FrameTrack, TrailLayer, TrailTrack } from '../../src/renderer/trail.js';

function spyLayer(): { calls: Array<Array<[number, number]>>; layer: TrailLayer } {
  const calls: Array<Array<[number, number]>> = [];
  return {
    calls,
    layer: {
      setLatLngs(points: Array<[number, number]>): void {
        calls.push(points.map((p) => [p[0], p[1]] as [number, number]));
      },
    },
  };
}

// Per-frame positions along a straight line; the decimated track keeps every
// second frame and picks its points from the frame arrays, exactly like
// decimateTrack copies them.
function track(points: number): { trail: TrailTrack; frames: FrameTrack } {
  const lat: number[] = [];
  const lon: number[] = [];
  for (let f = 0; f < points * 2 - 1; f++) {
    lat.push(46 + f * 0.0005);
    lon.push(14 + f * 0.0005);
  }
  const frame: number[] = [];
  for (let j = 0; j < points; j++) frame.push(j * 2);
  return {
    trail: {
      lat: frame.map((f) => lat[f]),
      lon: frame.map((f) => lon[f]),
      frame,
    },
    frames: { lat, lon },
  };
}

function pos(f: number): [number, number] {
  return [46 + f * 0.0005, 14 + f * 0.0005];
}

describe('lastIndexAtOrBefore', () => {
  it.for([
    { name: 'empty array has no index', frames: [], i: 5, want: -1 },
    { name: 'all frames greater than i', frames: [2, 4, 6], i: 1, want: -1 },
    { name: 'before the first frame', frames: [2, 4, 6], i: 0, want: -1 },
    { name: 'exact hit lands on its index', frames: [2, 4, 6], i: 4, want: 1 },
    { name: 'exact hit on the first frame', frames: [2, 4, 6], i: 2, want: 0 },
    { name: 'exact hit on the last frame', frames: [2, 4, 6], i: 6, want: 2 },
    { name: 'between hits lands on the earlier index', frames: [2, 4, 6], i: 3, want: 0 },
    { name: 'between later hits lands on the earlier index', frames: [2, 4, 6], i: 5, want: 1 },
    { name: 'past the last frame lands on it', frames: [2, 4, 6], i: 100, want: 2 },
    { name: 'single point hit', frames: [7], i: 7, want: 0 },
  ])('$name', ({ frames, i, want }) => {
    expect(lastIndexAtOrBefore(frames, i)).toBe(want);
  });
});

describe('createTrailController', () => {
  it('grows the prefix and moves the tip with every forward frame', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    for (let i = 0; i <= 8; i++) ctl.setFrame(i);
    expect(a.calls).toEqual([
      [pos(0)],
      [pos(0), pos(1)],
      [pos(0), pos(2)],
      [pos(0), pos(2), pos(3)],
      [pos(0), pos(2), pos(4)],
      [pos(0), pos(2), pos(4), pos(5)],
      [pos(0), pos(2), pos(4), pos(6)],
      [pos(0), pos(2), pos(4), pos(6), pos(7)],
      [pos(0), pos(2), pos(4), pos(6), pos(8)],
    ]);
  });

  it('ends the trail at the frame position, not at the last kept point', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    ctl.setFrame(3);
    expect(a.calls.at(-1)).toEqual([pos(0), pos(2), pos(3)]);
  });

  it('replaces the coinciding kept point with the tip instead of duplicating it', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    ctl.setFrame(4);
    expect(a.calls.at(-1)).toEqual([pos(0), pos(2), pos(4)]);
  });

  it('truncates the trail on backward seeks with no stale segments', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    ctl.setFrame(8);
    a.calls.length = 0;
    ctl.setFrame(5);
    expect(a.calls).toEqual([[pos(0), pos(2), pos(4), pos(5)]]);
  });

  it('truncates back to the very first point', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    ctl.setFrame(8);
    a.calls.length = 0;
    ctl.setFrame(0);
    expect(a.calls).toEqual([[pos(0)]]);
  });

  it('draws a large forward jump in one setLatLngs with a bounded prefix', () => {
    const t = track(101);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    ctl.setFrame(0);
    a.calls.length = 0;
    ctl.setFrame(100);
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0]).toHaveLength(51);
    expect(a.calls[0][0]).toEqual(pos(0));
    expect(a.calls[0][50]).toEqual(pos(100));
  });

  it('is idempotent for repeated frame indices', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    ctl.setFrame(4);
    a.calls.length = 0;
    ctl.setFrame(4);
    ctl.setFrame(4);
    expect(a.calls).toEqual([]);
  });

  it('drives all layers with identical updates', () => {
    const t = track(3);
    const a = spyLayer();
    const b = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer, b.layer]);
    ctl.setFrame(0);
    ctl.setFrame(1);
    ctl.setFrame(4);
    ctl.setFrame(2);
    expect(a.calls).toEqual(b.calls);
  });

  it('stays quiet for an empty track', () => {
    const a = spyLayer();
    const ctl = createTrailController(
      { lat: [], lon: [], frame: [] },
      { lat: [], lon: [] },
      [a.layer],
    );
    ctl.setFrame(100);
    ctl.setFrame(101);
    expect(a.calls).toEqual([]);
  });

  it('truncates fully when the target precedes the first decimated point', () => {
    const t = track(3);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    ctl.setFrame(4);
    a.calls.length = 0;
    ctl.setFrame(-1);
    expect(a.calls).toEqual([[]]);
  });

  it('falls back to the prefix when the frame lies beyond the frame track', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.trail, t.frames, [a.layer]);
    ctl.setFrame(20);
    expect(a.calls.at(-1)).toEqual([pos(0), pos(2), pos(4), pos(6), pos(8)]);
  });

  // Issue #95 regression: a hovering or straight flight decimates to its
  // endpoints, so a prefix-only trail stayed a single (invisible) point for
  // the whole flight and the map canvas never changed. The tip keeps the
  // trail reaching the drone and growing on every frame.
  it('grows the trail to the drone even when decimation collapses the track', () => {
    const lat = Array.from({ length: 11 }, (_, f) => 46.5 + f * 0.00001);
    const lon = Array.from({ length: 11 }, (_, f) => 14.2 + f * 0.00001);
    const trail: TrailTrack = {
      lat: [lat[0], lat[10]],
      lon: [lon[0], lon[10]],
      frame: [0, 10],
    };
    const a = spyLayer();
    const ctl = createTrailController(trail, { lat, lon }, [a.layer]);

    ctl.setFrame(5);
    expect(a.calls.at(-1)).toEqual([
      [lat[0], lon[0]],
      [lat[5], lon[5]],
    ]);

    a.calls.length = 0;
    ctl.setFrame(6);
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0].at(-1)).toEqual([lat[6], lon[6]]);
  });
});
