'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { FilmstripCache, sameFrames, thumbPlan } from '../lib/filmstrip.js';
import type { ThumbSampler } from '../lib/thumbsampler.js';
import { createThumbSampler } from '../lib/thumbsampler.js';

interface UseFilmstripOptions {
  src: string;
  frames: number;
  fps: number;
  sampler?: ThumbSampler;
  createSampler?: (src: string, fps: number) => ThumbSampler;
}

interface FilmstripStrip {
  hostRef: RefObject<HTMLDivElement | null>;
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
      setCells((prev) => (sameFrames(prev, planned) ? prev : planned));
    };
    replan();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(replan);
    observer.observe(host);
    return () => observer.disconnect();
  }, [frames]);

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
  }, [cells, src, fps, sampler, createSampler]);

  const thumbs = batch.src === src ? batch.thumbs : EMPTY_THUMBS;
  return { hostRef, cells, thumbs };
}

const EMPTY_THUMBS: ReadonlyMap<number, string> = new Map();
