'use client';

import { useFilmstrip } from '../hooks/useFilmstrip.js';
import type { ThumbSampler } from '../lib/thumbsampler.js';

interface FilmstripProps {
  src: string;
  frames: number;
  fps: number;
  sampler?: ThumbSampler;
}

export function Filmstrip({ src, frames, fps, sampler }: FilmstripProps) {
  const { hostRef, cells, thumbs } = useFilmstrip({ src, frames, fps, sampler });
  return (
    <div className="filmstrip" ref={hostRef} aria-hidden="true">
      {cells.map((frame) => {
        const url = thumbs.get(frame);
        return (
          <div key={frame} className="film-cell">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
