'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { StageLayout } from '../lib/layout.js';
import { MapIsland } from './MapIsland.js';

export type MapCardProps =
  | { data: SceneData; onScene: (scene: Scene) => void; layout: StageLayout }
  | { data: null; layout: StageLayout };

interface SceneDelivery {
  scene: Scene;
  seq: number;
}

export function MapCard(props: MapCardProps) {
  const { layout } = props;
  const withScene = props.data === null ? null : props;
  const [delivery, setDelivery] = useState<SceneDelivery | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!delivery) return;
    let live = true;
    void delivery.scene.ready.then(() => {
      if (live) setMapReady(true);
    });
    return () => {
      live = false;
    };
  }, [delivery]);

  const handleScene = useCallback(
    (scene: Scene) => {
      // Every island mount re-enters the map-load phase, so readiness is
      // tracked per delivery rather than per scene instance.
      seq.current += 1;
      setMapReady(false);
      setDelivery({ scene, seq: seq.current });
      withScene?.onScene(scene);
    },
    [withScene],
  );

  return (
    <div className={`map-card map-card-${layout}`}>
      {withScene === null ? (
        <div className="map-card-empty">No telemetry yet</div>
      ) : (
        <>
          <MapIsland data={withScene.data} onScene={handleScene} />
          {mapReady ? null : (
            <div className="map-card-busy" role="status">
              Preparing map…
            </div>
          )}
          <div className="map-overlay-tag">Map</div>
        </>
      )}
    </div>
  );
}
