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
  /** A refused step's reason, announced through the readout's live region. */
  notice?: string;
}

export function ZoomPill({ zoom, visibleZoom, style, onStep, notice = '' }: ZoomPillProps) {
  const { min, max } = zoomLimits(style);
  const canOut = visibleZoom > min;
  const canIn = visibleZoom < max;
  // The readout states the level the map renders; auto-fit says so instead.
  const level = zoom === 0 ? 'auto' : String(visibleZoom);
  // At a limit the buttons stay focusable through aria-disabled, so the
  // keyboard highlight and the reason in the title get announced (#271).
  return (
    <div className="map-zoom-pill" role="group" aria-label="Map zoom">
      <button
        type="button"
        aria-label="Zoom out"
        aria-disabled={canOut ? undefined : 'true'}
        title={canOut ? 'Zoom the map out one level (-)' : 'Already zoomed all the way out'}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <span className="map-zoom-level" aria-live="polite" aria-atomic="true">
        <span className="sr-only">Zoom level </span>
        {level}
        {notice ? <span className="sr-only">. {notice}</span> : null}
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        aria-disabled={canIn ? undefined : 'true'}
        title={canIn ? 'Zoom the map in one level (+)' : 'Already zoomed all the way in'}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </div>
  );
}
