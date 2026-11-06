import { describe, expect, it, vi } from 'vitest';

import {
  FilmstripCache,
  MAX_THUMBS,
  MIN_THUMBS,
  thumbPlan,
} from '../../ui/lib/filmstrip.js';

describe('thumbPlan', () => {
  it.for([
    { name: 'no track', trackWidth: 0, frames: 300, want: [] },
    { name: 'no frames', trackWidth: 640, frames: 0, want: [] },
    { name: 'a single frame', trackWidth: 640, frames: 1, want: [0] },
  ])('$name yields no strip', ({ trackWidth, frames, want }) => {
    expect(thumbPlan(trackWidth, frames).frames).toEqual(want);
  });

  it('spaces thumbs by track width and spans the whole recording', () => {
    const plan = thumbPlan(640, 300);
    expect(plan.count).toBe(10);
    expect(plan.frames).toHaveLength(10);
    expect(plan.frames[0]).toBe(0);
    expect(plan.frames[plan.frames.length - 1]).toBe(299);
    expect([...plan.frames].sort((a, b) => a - b)).toEqual(plan.frames);
    expect(new Set(plan.frames).size).toBe(plan.frames.length);
  });

  it.for([
    { name: 'a narrow track clamps to the floor', trackWidth: 100, want: MIN_THUMBS },
    { name: 'a wide track clamps to the cap', trackWidth: 10000, want: MAX_THUMBS },
    { name: 'an hour of frames costs the same as a minute', trackWidth: 640, want: 10 },
  ])('$name', ({ trackWidth, want }) => {
    // The last case pins the width-driven bound: duration never adds thumbs.
    const frames = trackWidth === 640 ? 108000 : 300;
    expect(thumbPlan(trackWidth, frames).count).toBe(want);
  });
});

describe('FilmstripCache', () => {
  function fakeCache(grab: (frame: number) => Promise<string | null>) {
    const released: string[] = [];
    const cache = new FilmstripCache({ grab, release: (url) => released.push(url) });
    return { cache, released };
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('fills missing frames in order and reports each arrival', async () => {
    const seen: number[] = [];
    const { cache } = fakeCache(async (frame) => `url-${frame}`);
    cache.load([5, 2, 9], (frame) => seen.push(frame));
    await settle();
    expect(seen).toEqual([5, 2, 9]);
    expect(cache.size).toBe(3);
  });

  it('skips frames already cached instead of grabbing them again', async () => {
    const grab = vi.fn(async (frame: number) => `url-${frame}`);
    const { cache } = fakeCache(grab);
    cache.load([1, 2], () => {});
    await settle();
    cache.load([1, 2, 3], () => {});
    await settle();
    expect(grab).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(3);
  });

  it('skips a failed frame and leaves it for the next load', async () => {
    let failedOnce = false;
    const grab = vi.fn(async (frame: number) => {
      if (frame === 2 && !failedOnce) {
        failedOnce = true;
        return null;
      }
      return `url-${frame}`;
    });
    const seen: number[] = [];
    const { cache } = fakeCache(grab);
    cache.load([1, 2, 3], (frame) => seen.push(frame));
    await settle();
    expect(seen).toEqual([1, 3]);
    cache.load([2], (frame) => seen.push(frame));
    await settle();
    expect(seen).toEqual([1, 3, 2]);
    expect(grab).toHaveBeenCalledTimes(4);
  });

  it('cancels an older run when a new load starts', async () => {
    const seen: number[] = [];
    const released: string[] = [];
    const cache = new FilmstripCache({
      grab: async (frame) => (frame === 1 ? 'late-1' : `url-${frame}`),
      release: (url) => released.push(url),
    });
    cache.load([1], (frame) => seen.push(frame));
    cache.load([2], (frame) => seen.push(frame));
    await settle();
    expect(seen).toEqual([2]);
    expect(released).toContain('late-1');
  });

  it('releases every cached thumb on dispose', async () => {
    const { cache, released } = fakeCache(async (frame) => `url-${frame}`);
    cache.load([1, 2], () => {});
    await settle();
    cache.dispose();
    expect(released.sort()).toEqual(['url-1', 'url-2']);
    expect(cache.size).toBe(0);
  });

  it('cancel keeps cached thumbs but stops the run', async () => {
    const seen: number[] = [];
    const { cache } = fakeCache(async (frame) => `url-${frame}`);
    cache.load([1], (frame) => seen.push(frame));
    await settle();
    cache.cancel();
    cache.load([2], (frame) => seen.push(frame));
    cache.cancel();
    await settle();
    expect(seen).toEqual([1]);
    expect(cache.size).toBe(1);
  });
});
