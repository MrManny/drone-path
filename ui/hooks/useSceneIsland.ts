'use client';

import { useEffect, useRef } from 'react';

import { bootScene } from '../../src/renderer/boot.js';
import type { Scene, SceneData } from '../../src/renderer/scene.js';

export interface SceneIslandOptions {
  data: SceneData;
  /** Seek target; omitted for hosts an external frame driver seeks. */
  frame?: number;
  onScene?: (scene: Scene) => void;
}

// One scene-island lifecycle for every mount point (the player's map island and
// the export preview): the shared scene is created after mount because Leaflet
// only loads in the browser, restyled in place on data changes, and disposed on
// unmount so its injected styles and Leaflet map cannot outlive the host. A
// ResizeObserver re-lays out whenever the box settles or changes: the pane size
// may still be zero at creation time.
export function useSceneIsland({ data, frame, onScene }: SceneIslandOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const dataRef = useRef(data);
  const frameRef = useRef(frame);
  const onSceneRef = useRef(onScene);

  // The boot effect below runs once, after the lazy Leaflet import settles;
  // syncing the latest props here keeps it from building the scene against
  // stale props without remounting the map.
  useEffect(() => {
    dataRef.current = data;
    frameRef.current = frame;
    onSceneRef.current = onScene;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const observer = new ResizeObserver(() => sceneRef.current?.relayout());
    observer.observe(host);
    void (async () => {
      const { default: L } = await import('leaflet');
      if (cancelled) return;
      const created = bootScene(host, dataRef.current, L);
      sceneRef.current = created;
      onSceneRef.current?.(created);
      if (frameRef.current !== undefined) created.setFrame(frameRef.current);
    })();
    return () => {
      cancelled = true;
      observer.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(data);
  }, [data]);

  useEffect(() => {
    if (frame !== undefined) sceneRef.current?.setFrame(frame);
  }, [frame]);

  return hostRef;
}
