'use client';

import type { RefObject } from 'react';

import type { StageLayout } from '../lib/layout.js';
import type { ZoomControls } from '../lib/mapzoom.js';
import { ZoomReadout } from './ZoomReadout.js';
import { ZoomStepper } from './ZoomStepper.js';

export interface MapStripProps {
  /** The scene writes the readout columns into this host; it stays mounted. */
  hudHostRef: RefObject<HTMLDivElement | null>;
  layout: StageLayout;
  zoomControls?: ZoomControls;
  /** The level the map currently shows, as planned for the preview. */
  visibleZoom: number;
}

/** The one compact surface below the map: Speed | Altitude readouts beside the
    Zoom column. The readouts are scene-owned; the Zoom column carries the bare
    stepper in split view and only its readout in the compact PiP card — the
    level and its live region stay mounted in both layouts (#287). */
export function MapStrip({ hudHostRef, layout, zoomControls, visibleZoom }: MapStripProps) {
  return (
    <div className="map-card-strip">
      <div className="map-strip-readouts" ref={hudHostRef} />
      {zoomControls ? (
        <div className="map-strip-zoom">
          <span className="label">Zoom</span>
          {layout === 'split' ? (
            <ZoomStepper
              zoom={zoomControls.zoom}
              visibleZoom={visibleZoom}
              style={zoomControls.style}
              onStep={zoomControls.onStep}
              notice={zoomControls.notice}
            />
          ) : (
            <ZoomReadout
              zoom={zoomControls.zoom}
              visibleZoom={visibleZoom}
              notice={zoomControls.notice}
            />
          )}
          {zoomControls.notice ? (
            <span className="field-message map-zoom-message" aria-hidden="true">
              {zoomControls.notice}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
