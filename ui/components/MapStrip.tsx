'use client';

import type { RefObject } from 'react';

import type { StageLayout } from '../lib/layout.js';
import type { ZoomControls } from '../lib/mapzoom.js';
import { ZoomPill } from './ZoomPill.js';

export interface MapStripProps {
  /** The scene writes the readout columns into this host; it stays mounted. */
  hudHostRef: RefObject<HTMLDivElement | null>;
  layout: StageLayout;
  zoomControls?: ZoomControls;
  /** The level the map currently shows, as planned for the preview. */
  visibleZoom: number;
}

/** The one compact surface below the map: Speed | Altitude readouts beside the
    Zoom stepper. The readouts are scene-owned; the Zoom column is split-view
    only — the compact PiP card keeps no zoom controls. */
export function MapStrip({ hudHostRef, layout, zoomControls, visibleZoom }: MapStripProps) {
  return (
    <div className="map-card-strip">
      <div className="map-strip-readouts" ref={hudHostRef} />
      {layout === 'split' && zoomControls ? (
        <div className="map-strip-zoom">
          <span className="label">Zoom</span>
          <ZoomPill
            zoom={zoomControls.zoom}
            visibleZoom={visibleZoom}
            style={zoomControls.style}
            onStep={zoomControls.onStep}
            notice={zoomControls.notice}
          />
        </div>
      ) : null}
    </div>
  );
}
