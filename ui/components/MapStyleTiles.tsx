'use client';

import { MAP_STYLE_VALUES } from '../../src/config.js';
import type { MapStyle } from '../../src/config.js';
import { TILE_CREDITS } from '../../src/renderer/tilesources.js';
import { STYLE_LABELS } from '../lib/settings.js';
import satelliteThumb from '../assets/map-style/satellite.jpg';
import topoThumb from '../assets/map-style/topo.jpg';

interface MapStyleTilesProps {
  value: MapStyle;
  onChange: (style: MapStyle) => boolean;
}

// The image import is a URL string in tests and a static asset object in the
// Next build; both expose the same source through this accessor.
type Thumb = string | { src: string };

function thumbSrc(thumb: Thumb): string {
  return typeof thumb === 'string' ? thumb : thumb.src;
}

const THUMBS: Record<MapStyle, Thumb> = {
  satellite: satelliteThumb,
  topo: topoThumb,
};

/** Map style as two thumbnail tiles instead of a dropdown. */
export function MapStyleTiles({ value, onChange }: MapStyleTilesProps) {
  return (
    <div>
      <div className="map-style-tiles" role="group" aria-label="Map style">
        {MAP_STYLE_VALUES.map((style) => (
          <button
            key={style}
            type="button"
            className="map-style-tile"
            aria-pressed={value === style}
            onClick={() => onChange(style)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="map-style-thumb" src={thumbSrc(THUMBS[style])} alt="" />
            <span className="map-style-label">{STYLE_LABELS[style]}</span>
          </button>
        ))}
      </div>
      <p className="hint">{TILE_CREDITS}</p>
    </div>
  );
}
