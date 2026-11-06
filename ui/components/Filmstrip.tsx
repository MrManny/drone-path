'use client';

import { useEffect, useRef, useState } from 'react';

import { FilmstripCache, thumbPlan } from '../lib/filmstrip.js';
import type { ThumbSampler } from '../lib/thumbsampler.js';
import { createThumbSampler } from '../lib/thumbsampler.js';

export interface FilmstripProps {
  /** The video's media URL; sampled through a hidden secondary element. */
  src: string;
  frames: number;
  fps: number;
  /** Test seam: replaces the canvas sampler over a hidden video element. */
  sampler?: ThumbSampler;
}

// The video track's thumbnail strip: evenly spaced frames across the
// recording, filled left to right as the sampler produces them. Decorative
// — the range slider over the track is the accessible scrub control.
export function Filmstrip({ src, frames, fps, sampler }: FilmstripProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<readonly number[]>([]);
  const [thumbs, setThumbs] = useState<ReadonlyMap<number, string>>(() => new Map());

  // The plan follows the track's width; thumbs already cached survive a
  // re-plan and only the new frames stream in.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const replan = (): void => setPlan(thumbPlan(host.clientWidth, frames).frames);
    replan();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(replan);
    observer.observe(host);
    return () => observer.disconnect();
  }, [frames, fps]);

  useEffect(() => {
    const used = sampler ?? createThumbSampler(src, fps);
    const cache = new FilmstripCache({
      grab: (frame) => used.grab(frame),
      release: (url) => URL.revokeObjectURL(url),
    });
    cache.load(plan, (frame, url) => setThumbs((prev) => new Map(prev).set(frame, url)));
    return () => cache.dispose();
  }, [src, fps, sampler, plan]);

  return (
    <div className="filmstrip" ref={hostRef} aria-hidden="true">
      {plan.map((frame) => {
        const url = thumbs.get(frame);
        return (
          <div key={frame} className="film-cell">
            {url ? (
              // Object-URL thumbnails cannot go through next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
