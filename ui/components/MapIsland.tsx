'use client';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import { useSceneIsland } from '../hooks/useSceneIsland.js';
import 'leaflet/dist/leaflet.css';

export interface MapIslandProps {
  data: SceneData;
  onScene: (scene: Scene) => void;
}

// The player's map island: the shared scene lives as long as the recording and
// restyles in place on settings changes (useSceneIsland owns the lifecycle).
export function MapIsland({ data, onScene }: MapIslandProps) {
  const hostRef = useSceneIsland({ data, onScene });

  // Leaflet's internal panes are z-indexed up to 700; isolating the host
  // keeps them from painting over the picture-in-picture pane.
  return <div id="scene-host" className="scene-host" style={{ isolation: 'isolate' }} ref={hostRef} />;
}
