'use client';

import { useTranslation } from '../lib/i18n.js';
import { useFilmstrip } from '../hooks/useFilmstrip.js';
import type { ThumbSampler } from '../lib/thumbsampler.js';
import { BusyStatus } from './BusyStatus.js';

interface FilmstripProps {
  src: string;
  frames: number;
  fps: number;
  sampler?: ThumbSampler;
}

export function Filmstrip({ src, frames, fps, sampler }: FilmstripProps) {
  const t = useTranslation();
  const { hostRef, cells, thumbs, busy } = useFilmstrip({ src, frames, fps, sampler });
  return (
    <>
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
      {busy ? <BusyStatus>{t('filmstrip.preparingFilmstrip')}</BusyStatus> : null}
    </>
  );
}
