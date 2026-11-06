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
    currentTime: number;
    emit: (type: string) => void;
    completeSeek: () => void;
    removeAttribute: (name: string) => void;
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
  };
  ctx: { drawImage: ReturnType<typeof vi.fn> };
  blob: unknown;
}

// A document whose video seeks complete only when the test says so, and
// whose canvas produces a stub blob, so the sampler runs offline with no
// decoder and pending seeks stay observable.
function fakeMedia(options: { blob?: unknown } = {}): FakeMedia {
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
  const video = {
    muted: false,
    preload: '',
    src: '',
    readyState: 0,
    get currentTime(): number {
      return currentTime;
    },
    set currentTime(value: number) {
      currentTime = value;
    },
    emit: (type: string): void => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    completeSeek: (): void => {
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
  const ctx = { drawImage: vi.fn() };
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
  return { doc, video, ctx, blob };
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
    expect(media.ctx.drawImage).toHaveBeenCalledWith(media.video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    expect(createObjectURL).toHaveBeenCalledWith(media.blob);
    sampler.dispose();
    createObjectURL.mockRestore();
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
});
