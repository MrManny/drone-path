'use client';

import { useFilmstrip } from '../hooks/useFilmstrip.js';
import type { ThumbSampler } from '../lib/thumbsampler.js';

export interface FilmstripProps {
  /** The video's media URL; sampled through a hidden secondary element. */
  src: string;
  frames: number;
  fps: number;
  /** Test seam: replaces the canvas sampler; the caller keeps ownership. */
  sampler?: ThumbSampler;
}

// Decorative: the range slider over the track is the accessible scrub
// control.
export function Filmstrip({ src, frames, fps, sampler }: FilmstripProps) {
  const { hostRef, cells, thumbs } = useFilmstrip({ src, frames, fps, sampler });
  return (
    <div className="filmstrip" ref={hostRef} aria-hidden="true">
      {cells.map((frame) => {
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
