'use client';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { StageLayout } from '../lib/layout.js';
import { MapIsland } from './MapIsland.js';

export type MapCardProps =
  | { data: SceneData; onScene: (scene: Scene) => void; layout: StageLayout }
  /** Before a recording loads: no scene exists, so the card stays a placeholder. */
  | { data: null; layout: StageLayout };

// The map's own structure never changes between the two layouts — only CSS
// turns the overlay variant into a floating card with a tag — so the map
// island stays mounted and synchronized across a view swap.
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
