'use client';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { StageLayout } from '../lib/layout.js';
import { MapIsland } from './MapIsland.js';

export interface MapCardProps {
  data: SceneData;
  onScene: (scene: Scene) => void;
  layout: StageLayout;
}

// The map's own structure never changes between the two layouts — only CSS
// turns the overlay variant into a floating card with a tag — so the map
// island stays mounted and synchronized across a view swap.
export function MapCard({ data, onScene, layout }: MapCardProps) {
  return (
    <div className={`map-card map-card-${layout}`}>
      <MapIsland data={data} onScene={onScene} />
      <div className="map-overlay-tag">Map</div>
    </div>
  );
}
