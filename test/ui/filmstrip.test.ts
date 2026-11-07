import { describe, expect, it, vi } from 'vitest';

import {
  FilmstripCache,
  TARGET_THUMBS,
  thumbPlan,
} from '../../ui/lib/filmstrip.js';

describe('thumbPlan', () => {
  it.for([
    { name: 'no track', trackWidth: 0, frames: 300, want: [] },
    { name: 'no frames', trackWidth: 640, frames: 0, want: [] },
    { name: 'a single frame', trackWidth: 640, frames: 1, want: [0] },
    { name: 'a track too narrow for one still', trackWidth: 50, frames: 300, want: [] },
  ])('$name', ({ trackWidth, frames, want }) => {
    expect(thumbPlan(trackWidth, frames).frames).toEqual(want);
  });

  it.for([
    { name: 'a four-frame clip', trackWidth: 640, frames: 4, want: [0, 1, 2, 3] },
    { name: 'a two-frame clip', trackWidth: 640, frames: 2, want: [0, 1] },
    {
      name: 'a clip as short as the still budget',
      trackWidth: 768,
      frames: 12,
      want: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    },
  ])('$name samples every frame', ({ trackWidth, frames, want }) => {
    expect(thumbPlan(trackWidth, frames).frames).toEqual(want);
  });

  it('spaces stills equidistant from the first frame to the last', () => {
    expect(thumbPlan(768, 23).frames).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
    const spread = thumbPlan(640, 300).frames;
    expect(spread[0]).toBe(0);
    expect(spread[spread.length - 1]).toBe(299);
    expect(new Set(spread).size).toBe(spread.length);
    const gaps = spread.slice(1).map((frame, index) => frame - spread[index]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it.for([
    { name: 'a wide track caps at the still budget', trackWidth: 10000, frames: 300, want: TARGET_THUMBS },
    { name: 'a narrow track shows fewer stills', trackWidth: 320, frames: 300, want: 5 },
    { name: 'a minute of frames', trackWidth: 640, frames: 1800, want: 10 },
    { name: 'an hour of frames costs the same as a minute', trackWidth: 640, frames: 108000, want: 10 },
  ])('$name', ({ trackWidth, frames, want }) => {
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

  it('shares one fill when the same plan loads twice', async () => {
    const resolvers: Array<(url: string | null) => void> = [];
    const grab = vi.fn(
      (_frame: number) => new Promise<string | null>((resolve) => resolvers.push(resolve)),
    );
    const { cache } = fakeCache(grab);
    const first: number[] = [];
    const second: number[] = [];
    cache.load([1, 2, 3], (frame) => first.push(frame));
    cache.load([1, 2, 3], (frame) => second.push(frame));
    for (let i = 0; i < 3; i += 1) {
      await settle();
      resolvers[i](`url-${i + 1}`);
    }
    await settle();
    expect(grab.mock.calls.map(([frame]) => frame)).toEqual([1, 2, 3]);
    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([1, 2, 3]);
    expect(cache.size).toBe(3);
  });

  it('caches completed grabs even when their run was superseded', async () => {
    const resolvers: Array<(url: string | null) => void> = [];
    const released: string[] = [];
    const cache = new FilmstripCache({
      grab: (_frame: number) => new Promise<string | null>((resolve) => resolvers.push(resolve)),
      release: (url) => released.push(url),
    });
    const seen: number[] = [];
    cache.load([1], (frame) => seen.push(frame));
    cache.load([2], (frame) => seen.push(frame));
    resolvers[0]('late-1');
    resolvers[1]('url-2');
    await settle();
    expect(seen).toEqual([2]);
    expect(cache.size).toBe(2);
    expect(released).toEqual([]);
  });

  it('cancel stops the run while completed grabs stay cached', async () => {
    const seen: number[] = [];
    const { cache } = fakeCache(async (frame) => `url-${frame}`);
    cache.load([1], (frame) => seen.push(frame));
    await settle();
    cache.cancel();
    cache.load([2], (frame) => seen.push(frame));
    cache.cancel();
    await settle();
    expect(seen).toEqual([1]);
    expect(cache.size).toBe(2);
  });

  it('releases every cached thumb on dispose', async () => {
    const { cache, released } = fakeCache(async (frame) => `url-${frame}`);
    cache.load([1, 2], () => {});
    await settle();
    cache.dispose();
    expect(released.sort()).toEqual(['url-1', 'url-2']);
    expect(cache.size).toBe(0);
  });

  it('releases a grab that lands after dispose', async () => {
    const resolvers: Array<(url: string | null) => void> = [];
    const released: string[] = [];
    const cache = new FilmstripCache({
      grab: (_frame: number) => new Promise<string | null>((resolve) => resolvers.push(resolve)),
      release: (url) => released.push(url),
    });
    cache.load([1], () => {});
    cache.dispose();
    resolvers[0]('late-1');
    await settle();
    expect(released).toEqual(['late-1']);
    expect(cache.size).toBe(0);
  });
});
