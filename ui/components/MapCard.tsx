'use client';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { StageLayout } from '../lib/layout.js';
import { MapIsland } from './MapIsland.js';

export type MapCardProps =
  | { data: SceneData; onScene: (scene: Scene) => void; layout: StageLayout }
  | { data: null; layout: StageLayout };

export function MapCard(props: MapCardProps) {
  const { layout } = props;
  return (
    <div className={`map-card map-card-${layout}`}>
      {props.data === null ? (
        <div className="map-card-empty">No telemetry yet</div>
      ) : (
        <>
          <MapIsland data={props.data} onScene={props.onScene} />
          <div className="map-overlay-tag">Map</div>
        </>
      )}
    </div>
  );
}
