'use client';

import { useMemo } from 'react';
import type { RefObject } from 'react';

import type { Scene, SceneData } from 'drone-path-engine/renderer/scene';
import { chipNames } from '../lib/chipreadouts.js';
import { useTranslation } from '../lib/i18n.js';
import { useSceneIsland } from '../hooks/useSceneIsland.js';
import 'leaflet/dist/leaflet.css';

interface MapIslandProps {
  data: SceneData;
  onScene: (scene: Scene) => void;
  /** External chip container (a map-card strip) outside the map image. */
  hudHostRef?: RefObject<HTMLElement | null>;
}

export function MapIsland({ data, onScene, hudHostRef }: MapIslandProps) {
  const t = useTranslation();
  const localizedData = useMemo(() => {
    if (!hudHostRef) return data;
    const labels = chipNames(t);
    return { ...data, stripLabels: { speed: labels.speed, altitude: labels.alt } };
  }, [data, hudHostRef, t]);
  const hostRef = useSceneIsland({ data: localizedData, onScene, hudHostRef });

  return <div id="scene-host" className="scene-host" style={{ isolation: 'isolate' }} ref={hostRef} />;
}
