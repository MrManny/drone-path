'use client';

import type { MapStyle } from '../../src/config.js';
import { zoomLimits } from '../../src/plan.js';

export interface ZoomPillProps {
  /** The pinned "Zoom" setting: 0 is auto-fit. */
  zoom: number;
  /** The level the map currently shows, as planned for the preview. */
  visibleZoom: number;
  style: MapStyle;
  onStep: (delta: 1 | -1) => void;
}

export function ZoomPill({ zoom, visibleZoom, style, onStep }: ZoomPillProps) {
  const { min, max } = zoomLimits(style);
  const canOut = visibleZoom > min;
  const canIn = visibleZoom < max;
  // The readout states the level the map renders; auto-fit says so instead.
  const level = zoom === 0 ? 'auto' : String(visibleZoom);
  return (
    <div className="map-zoom-pill" role="group" aria-label="Map zoom">
      <button
        type="button"
        aria-label="Zoom out"
        title={canOut ? 'Zoom out (−)' : 'Already at the farthest zoom'}
        disabled={!canOut}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <span className="map-zoom-level" aria-live="polite" aria-atomic="true">
        <span className="sr-only">Zoom level </span>
        {level}
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        title={canIn ? 'Zoom in (+)' : 'Already at the closest zoom'}
        disabled={!canIn}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </div>
  );
}
