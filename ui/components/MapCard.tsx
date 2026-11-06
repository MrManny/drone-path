'use client';

import type { RefObject } from 'react';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { RenderConfig } from '../../src/config.js';
import type { StageLayout } from '../lib/layout.js';
import { lookSummary } from '../lib/settings.js';
import { MapIsland } from './MapIsland.js';

export interface MapCardProps {
  data: SceneData;
  onScene: (scene: Scene) => void;
  layout: StageLayout;
  settings: Pick<RenderConfig, 'style' | 'view'>;
  /** The initial "position / duration" text; the readout updates imperatively. */
  positionReadout: string;
  positionRef: RefObject<HTMLSpanElement | null>;
}

// The card structure never changes between the two layouts — only CSS shows
// or hides the layout-specific parts — so the map island below it stays
// mounted and synchronized across a view swap.
export function MapCard({
  data,
  onScene,
  layout,
  settings,
  positionReadout,
  positionRef,
}: MapCardProps) {
  return (
    <div className={`map-card map-card-${layout}`}>
      <div className="map-card-head">
        <div className="map-card-names">
          <h2 className="map-card-title">Flight map</h2>
          <p className="map-card-look">{lookSummary(settings)}</p>
        </div>
        <span className="sync-pill">Synced</span>
      </div>
      <div className="map-host-wrap">
        <MapIsland data={data} onScene={onScene} />
        <div className="map-overlay-tag">Map · synced</div>
      </div>
      <div className="map-card-foot">
        <span>Current position</span>
        <strong className="readout">
          <span ref={positionRef}>{positionReadout}</span>
        </strong>
      </div>
      <p className="map-card-note">Map and video share the same playhead.</p>
    </div>
  );
}
