'use client';

import type { RefObject } from 'react';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import { useSceneIsland } from '../hooks/useSceneIsland.js';
import 'leaflet/dist/leaflet.css';

interface MapIslandProps {
  data: SceneData;
  onScene: (scene: Scene) => void;
  /** External chip container (a map-card strip) outside the map image. */
  hudHostRef?: RefObject<HTMLElement | null>;
}

export function MapIsland({ data, onScene, hudHostRef }: MapIslandProps) {
  const hostRef = useSceneIsland({ data, onScene, hudHostRef });

  return <div id="scene-host" className="scene-host" style={{ isolation: 'isolate' }} ref={hostRef} />;
}
