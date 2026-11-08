'use client';

// Filmstrip orchestration as imperative shell: the width-driven thumbnail
// plan, plus one sampler and cache per recording whose thumbs survive
// re-plans. The component below only renders the cells.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { FilmstripCache, sameFrames, thumbPlan } from '../lib/filmstrip.js';
import type { ThumbSampler } from '../lib/thumbsampler.js';
import { createThumbSampler } from '../lib/thumbsampler.js';

export interface UseFilmstripOptions {
  src: string;
  frames: number;
  fps: number;
  /** Test seam: replaces the default sampler; the caller keeps ownership. */
  sampler?: ThumbSampler;
  /** Test seam for the default sampler factory; the hook owns its result. */
  createSampler?: (src: string, fps: number) => ThumbSampler;
}

export interface FilmstripStrip {
  hostRef: RefObject<HTMLDivElement | null>;
  /** The frame indices shown as cells at the current track width. */
  cells: readonly number[];
  thumbs: ReadonlyMap<number, string>;
}

export function useFilmstrip({
  src,
  frames,
  fps,
  sampler,
  createSampler,
}: UseFilmstripOptions): FilmstripStrip {
  const hostRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<FilmstripCache | null>(null);
  const [cells, setCells] = useState<readonly number[]>([]);
  const [batch, setBatch] = useState<{ src: string; thumbs: ReadonlyMap<number, string> }>({
    src,
    thumbs: new Map(),
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const replan = (): void => {
      const planned = thumbPlan(host.clientWidth, frames).frames;
      // Keeping the reference on equal content stops the observer's initial
      // duplicate delivery from re-running the load effect at all.
      setCells((prev) => (sameFrames(prev, planned) ? prev : planned));
    };
    replan();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(replan);
    observer.observe(host);
    return () => observer.disconnect();
  }, [frames]);

  // One sampler and cache per recording: re-plans must not re-fetch the
  // media or re-grab frames the cache already holds.
  useEffect(() => {
    const owned = sampler === undefined;
    const used = sampler ?? (createSampler ?? createThumbSampler)(src, fps);
    const cache = new FilmstripCache({
      grab: (frame) => used.grab(frame),
      release: (url) => URL.revokeObjectURL(url),
    });
    cacheRef.current = cache;
    return () => {
      cacheRef.current = null;
      cache.dispose();
      if (owned) used.dispose();
    };
  }, [src, fps, sampler, createSampler]);

  useEffect(() => {
    cacheRef.current?.load(cells, (frame, url) =>
      setBatch((prev) => {
        const next = new Map(prev.src === src ? prev.thumbs : []);
        next.set(frame, url);
        return { src, thumbs: next };
      }),
    );
    // A recreated cache must load what the plan already holds.
  }, [cells, src, fps, sampler, createSampler]);

  // Thumbs sampled from another recording never show; the batch switches
  // over with its first arrival.
  const thumbs = batch.src === src ? batch.thumbs : EMPTY_THUMBS;
  return { hostRef, cells, thumbs };
}

const EMPTY_THUMBS: ReadonlyMap<number, string> = new Map();
