'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  busy: boolean;
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
  const source = useMemo(
    () => ({ src, fps, sampler, createSampler }),
    [src, fps, sampler, createSampler],
  );
  const [batch, setBatch] = useState<{
    cache: FilmstripCache | null;
    source: typeof source | null;
    thumbs: ReadonlyMap<number, string>;
  }>(EMPTY_BATCH);

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
    const owned = source.sampler === undefined;
    const used =
      source.sampler ?? (source.createSampler ?? createThumbSampler)(source.src, source.fps);
    const cache = new FilmstripCache({
      grab: (frame) => used.grab(frame),
      release: (url) => URL.revokeObjectURL(url),
    });
    cacheRef.current = cache;
    return () => {
      cacheRef.current = null;
      cache.dispose();
      if (owned) used.dispose();
      setBatch((prev) => (prev.cache === cache ? EMPTY_BATCH : prev));
    };
  }, [source]);

  const request = useMemo(() => ({ cells, source }), [cells, source]);
  const [settled, setSettled] = useState<typeof request | null>(null);

  useEffect(() => {
    const cache = cacheRef.current;
    if (!cache) return;
    cache.load(
      request.cells,
      (frame, url) => {
        setBatch((prev) => {
          const next = new Map(prev.cache === cache ? prev.thumbs : []);
          next.set(frame, url);
          return { cache, source: request.source, thumbs: next };
        });
      },
      () => setSettled(request),
    );
  }, [request]);

  const thumbs = batch.source === source ? batch.thumbs : EMPTY_THUMBS;
  return { hostRef, cells, thumbs, busy: cells.length > 0 && request !== settled };
}

const EMPTY_THUMBS: ReadonlyMap<number, string> = new Map();
const EMPTY_BATCH = {
  cache: null,
  source: null,
  thumbs: EMPTY_THUMBS,
} as const;
