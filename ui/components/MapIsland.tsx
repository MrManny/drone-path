'use client';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import { useSceneIsland } from '../hooks/useSceneIsland.js';
import 'leaflet/dist/leaflet.css';

export interface MapIslandProps {
  data: SceneData;
  onScene: (scene: Scene) => void;
}

export function MapIsland({ data, onScene }: MapIslandProps) {
  const hostRef = useSceneIsland({ data, onScene });

  return <div id="scene-host" className="scene-host" style={{ isolation: 'isolate' }} ref={hostRef} />;
}
