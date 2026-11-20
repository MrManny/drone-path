'use client';

import { useTranslation } from '../lib/i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { StageLayout } from '../lib/layout.js';
import type { ZoomControls } from '../lib/mapzoom.js';
import { BusyStatus } from './BusyStatus.js';
import { MapIsland } from './MapIsland.js';
import { MapStrip } from './MapStrip.js';

type MapCardProps =
  | {
      data: SceneData;
      onScene: (scene: Scene) => void;
      layout: StageLayout;
      zoomControls?: ZoomControls;
    }
  | { data: null; layout: StageLayout };

interface SceneDelivery {
  scene: Scene;
  seq: number;
}

export function MapCard(props: MapCardProps) {
  const t = useTranslation();
  const { layout } = props;
  const withScene = props.data === null ? null : props;
  const [delivery, setDelivery] = useState<SceneDelivery | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const seq = useRef(0);
  // The scene writes the chip readouts into the strip's readout host. It stays
  // mounted for the whole scene lifetime so the element the scene holds never
  // goes stale when the HUD toggles.
  const stripRef = useRef<HTMLDivElement>(null);

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
        <div className="map-card-empty">{t('mapCard.noFlightPathYet')}</div>
      ) : (
        <>
          <div className="map-card-map">
            <MapIsland data={withScene.data} onScene={handleScene} hudHostRef={stripRef} />
          </div>
          <MapStrip
            hudHostRef={stripRef}
            layout={layout}
            zoomControls={withScene.zoomControls}
            visibleZoom={withScene.data.zoom}
          />
          {mapReady ? null : <BusyStatus>{t('mapCard.preparingMap')}</BusyStatus>}
          <div className="map-overlay-tag">{t('mapCard.map')}</div>
        </>
      )}
    </div>
  );
}
