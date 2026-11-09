// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createThumbSampler, THUMB_HEIGHT, THUMB_WIDTH } from '../../ui/lib/thumbsampler.js';

interface FakeMedia {
  doc: Document;
  video: {
    muted: boolean;
    preload: string;
    src: string;
    readyState: number;
    videoWidth: number;
    videoHeight: number;
    currentTime: number;
    seeking: boolean;
    emit: (type: string) => void;
    completeSeek: () => void;
    removeAttribute: (name: string) => void;
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
  };
  ctx: { drawImage: ReturnType<typeof vi.fn> };
  draws: number[];
  blob: unknown;
}

// Like Chromium, the fake seeks
// only to a new position and a no-op seek never fires 'seeked'.
function fakeMedia(
  options: { blob?: unknown; videoWidth?: number; videoHeight?: number } = {},
): FakeMedia {
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void): void => {
    const set = listeners.get(type) ?? new Set();
    set.add(fn);
    listeners.set(type, set);
  };
  const off = (type: string, fn: () => void): void => {
    listeners.get(type)?.delete(fn);
  };
  let currentTime = 0;
  let seekPending = false;
  const draws: number[] = [];
  const video = {
    muted: false,
    preload: '',
    src: '',
    readyState: 0,
    videoWidth: options.videoWidth ?? 640,
    videoHeight: options.videoHeight ?? 360,
    get currentTime(): number {
      return currentTime;
    },
    get seeking(): boolean {
      return seekPending;
    },
    set currentTime(value: number) {
      if (value === currentTime) return;
      currentTime = value;
      seekPending = true;
    },
    emit: (type: string): void => {
      if (type === 'seeked' || type === 'error' || type === 'emptied') seekPending = false;
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    completeSeek: (): void => {
      if (!seekPending) return;
      video.emit('seeked');
    },
    removeAttribute: (name: string): void => {
      if (name === 'src') {
        video.src = '';
        video.emit('emptied');
      }
    },
    addEventListener: on,
    removeEventListener: off,
  };
  const ctx = { drawImage: vi.fn(() => draws.push(currentTime)) };
  const blob = options.blob === undefined ? { size: 1 } : options.blob;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: unknown) => void): void => cb(blob),
  };
  const doc = {
    createElement: (tag: string): unknown => (tag === 'video' ? video : canvas),
  } as unknown as Document;
  return { doc, video, ctx, draws, blob };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createThumbSampler', () => {
  it('seeks to the frame mid-span, draws it and returns an object URL', async () => {
    const media = fakeMedia();
    media.video.readyState = 2;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const sampler = createThumbSampler('/video', 30, media.doc);
    const pending = sampler.grab(5);
    await settle();
    media.video.completeSeek();
    await expect(pending).resolves.toBe('blob:thumb');
    expect(media.video.currentTime).toBeCloseTo(5.5 / 30);
    expect(media.ctx.drawImage).toHaveBeenCalledWith(
      media.video,
      140,
      0,
      360,
      360,
      0,
      0,
      THUMB_WIDTH,
      THUMB_HEIGHT,
    );
    expect(createObjectURL).toHaveBeenCalledWith(media.blob);
    sampler.dispose();
    createObjectURL.mockRestore();
  });

  it('draws a grab at the element\'s current position without a seek event', async () => {
    const media = fakeMedia();
    media.video.readyState = 2;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const sampler = createThumbSampler('/video', 30, media.doc);
    const first = sampler.grab(5);
    await settle();
    media.video.completeSeek();
    await expect(first).resolves.toBe('blob:thumb');
    await expect(sampler.grab(5)).resolves.toBe('blob:thumb');
    expect(media.ctx.drawImage).toHaveBeenCalledTimes(2);
    sampler.dispose();
    createObjectURL.mockRestore();
  });

  it('keeps overlapping grabs on their own frames', async () => {
    const media = fakeMedia();
    media.video.readyState = 2;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const sampler = createThumbSampler('/video', 30, media.doc);
    const first = sampler.grab(5);
    const second = sampler.grab(8);
    await settle();
    expect(media.video.currentTime).toBeCloseTo(5.5 / 30);
    media.video.completeSeek();
    await expect(first).resolves.toBe('blob:thumb');
    await settle();
    expect(media.video.currentTime).toBeCloseTo(8.5 / 30);
    media.video.completeSeek();
    await expect(second).resolves.toBe('blob:thumb');
    expect(media.draws).toHaveLength(2);
    expect(media.draws[0]).toBeCloseTo(5.5 / 30);
    expect(media.draws[1]).toBeCloseTo(8.5 / 30);
    sampler.dispose();
    createObjectURL.mockRestore();
  });

  it('ignores a seeked that lands away from the requested frame', async () => {
    const media = fakeMedia();
    media.video.readyState = 2;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const sampler = createThumbSampler('/video', 30, media.doc);
    let settled = false;
    const pending = sampler.grab(5).then((url) => {
      settled = true;
      return url;
    });
    await settle();
    media.video.currentTime = 50 / 30;
    media.video.completeSeek();
    await settle();
    expect(settled).toBe(false);
    expect(media.ctx.drawImage).not.toHaveBeenCalled();
    media.video.currentTime = 5.5 / 30;
    media.video.completeSeek();
    await expect(pending).resolves.toBe('blob:thumb');
    expect(media.draws[0]).toBeCloseTo(5.5 / 30);
    sampler.dispose();
    createObjectURL.mockRestore();
  });

  it('settles to null when the seek event never arrives', async () => {
    vi.useFakeTimers();
    try {
      const media = fakeMedia();
      media.video.readyState = 2;
      const sampler = createThumbSampler('/video', 30, media.doc);
      const pending = sampler.grab(3);
      await vi.advanceTimersByTimeAsync(0);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeNull();
      expect(media.ctx.drawImage).not.toHaveBeenCalled();
      sampler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null when the media never loads', async () => {
    const media = fakeMedia();
    const sampler = createThumbSampler('/video', 30, media.doc);
    media.video.emit('error');
    await expect(sampler.grab(0)).resolves.toBeNull();
    expect(media.ctx.drawImage).not.toHaveBeenCalled();
    sampler.dispose();
  });

  it('settles to null when the media errors mid-seek', async () => {
    const media = fakeMedia();
    media.video.readyState = 2;
    const sampler = createThumbSampler('/video', 30, media.doc);
    const pending = sampler.grab(3);
    await settle();
    media.video.emit('error');
    await expect(pending).resolves.toBeNull();
    expect(media.ctx.drawImage).not.toHaveBeenCalled();
    sampler.dispose();
  });

  it('settles to null when dispose aborts a pending seek', async () => {
    const media = fakeMedia();
    media.video.readyState = 2;
    const sampler = createThumbSampler('/video', 30, media.doc);
    const pending = sampler.grab(3);
    await settle();
    sampler.dispose();
    await expect(pending).resolves.toBeNull();
    expect(media.ctx.drawImage).not.toHaveBeenCalled();
  });

  it('returns null for a frame grabbed after dispose', async () => {
    const media = fakeMedia();
    media.video.readyState = 2;
    const sampler = createThumbSampler('/video', 30, media.doc);
    sampler.dispose();
    await expect(sampler.grab(3)).resolves.toBeNull();
    expect(media.ctx.drawImage).not.toHaveBeenCalled();
  });

  it('returns null when the canvas cannot produce a blob', async () => {
    const media = fakeMedia({ blob: null });
    media.video.readyState = 2;
    const sampler = createThumbSampler('/video', 30, media.doc);
    const pending = sampler.grab(0);
    await settle();
    media.video.completeSeek();
    await expect(pending).resolves.toBeNull();
    sampler.dispose();
  });

  it('drops the media source on dispose', async () => {
    const media = fakeMedia();
    const sampler = createThumbSampler('/video', 30, media.doc);
    expect(media.video.src).toBe('/video');
    sampler.dispose();
    expect(media.video.src).toBe('');
  });

  it.for<{
    name: string;
    videoWidth: number;
    videoHeight: number;
    crop: [number, number, number, number];
  }>([
    { name: 'a wide frame', videoWidth: 640, videoHeight: 360, crop: [140, 0, 360, 360] },
    { name: 'a tall frame', videoWidth: 360, videoHeight: 640, crop: [0, 140, 360, 360] },
    { name: 'a square frame', videoWidth: 480, videoHeight: 480, crop: [0, 0, 480, 480] },
    { name: 'an odd wide frame', videoWidth: 641, videoHeight: 360, crop: [140.5, 0, 360, 360] },
    { name: 'a one-pixel frame', videoWidth: 1, videoHeight: 1, crop: [0, 0, 1, 1] },
    { name: 'an odd tall frame', videoWidth: 3, videoHeight: 4, crop: [0, 0.5, 3, 3] },
  ])('center-crops $name into the square canvas', async ({ videoWidth, videoHeight, crop }) => {
    const media = fakeMedia({ videoWidth, videoHeight });
    media.video.readyState = 2;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const sampler = createThumbSampler('/video', 30, media.doc);
    const pending = sampler.grab(0);
    await settle();
    media.video.completeSeek();
    await expect(pending).resolves.toBe('blob:thumb');
    expect(media.ctx.drawImage).toHaveBeenCalledWith(
      media.video,
      ...crop,
      0,
      0,
      THUMB_WIDTH,
      THUMB_HEIGHT,
    );
    sampler.dispose();
    createObjectURL.mockRestore();
  });

  it.for([
    { name: 'no coded size', videoWidth: 0, videoHeight: 0 },
    { name: 'no width', videoWidth: 0, videoHeight: 360 },
    { name: 'no height', videoWidth: 640, videoHeight: 0 },
  ])('settles to null when the frame has $name', async ({ videoWidth, videoHeight }) => {
    const media = fakeMedia({ videoWidth, videoHeight });
    media.video.readyState = 2;
    const sampler = createThumbSampler('/video', 30, media.doc);
    await expect(sampler.grab(0)).resolves.toBeNull();
    expect(media.ctx.drawImage).not.toHaveBeenCalled();
    sampler.dispose();
  });
});

describe('thumb size', () => {
  it('keeps the canvas square', () => {
    expect(THUMB_WIDTH).toBe(THUMB_HEIGHT);
  });
});
