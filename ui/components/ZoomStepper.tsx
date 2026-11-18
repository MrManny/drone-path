'use client';

import type { MapStyle } from '../../src/config.js';
import { zoomLimits } from '../../src/plan.js';
import { ZoomReadout } from './ZoomReadout.js';

export interface ZoomStepperProps {
  /** The pinned "Zoom level" setting: 0 is auto-fit. */
  zoom: number;
  /** The level the map currently shows, as planned for the preview. */
  visibleZoom: number;
  style: MapStyle;
  onStep: (delta: 1 | -1) => void;
  /** A refused step's reason, announced through the readout's live region. */
  notice?: string;
}

export function ZoomStepper({ zoom, visibleZoom, style, onStep, notice = '' }: ZoomStepperProps) {
  const { min, max } = zoomLimits(style);
  const canOut = visibleZoom > min;
  const canIn = visibleZoom < max;
  // At a limit the buttons stay focusable through aria-disabled, so the
  // keyboard highlight and the reason in the title get announced (#271).
  // The stepper is bare: no pill container and no button borders (#272).
  return (
    <div className="map-zoom-stepper" role="group" aria-label="Zoom level">
      <button
        type="button"
        aria-label="Zoom out"
        aria-disabled={canOut ? undefined : 'true'}
        title={canOut ? 'Zoom the map out one level (-)' : 'Already zoomed all the way out'}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <ZoomReadout zoom={zoom} visibleZoom={visibleZoom} notice={notice} />
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
