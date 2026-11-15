'use client';

import { MAP_STYLE_VALUES } from '../../src/config.js';
import type { MapStyle } from '../../src/config.js';
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

// The thumbnails are crops of real tiles, so they carry the tile credits.
const THUMB_CREDIT =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community · ' +
  '© OpenStreetMap contributors, SRTM · Style © OpenTopoMap (CC-BY-SA)';

/** Map style as two thumbnail tiles instead of a dropdown. */
export function MapStyleTiles({ value, onChange }: MapStyleTilesProps) {
  return (
    <div className="map-style-group">
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
      <p className="hint">{THUMB_CREDIT}</p>
    </div>
  );
}
