'use client';

import { useEffect, useRef } from 'react';

import { bootScene } from '../../src/renderer/boot.js';
import type { Scene, SceneData } from '../../src/renderer/scene.js';

export interface SceneIslandOptions {
  data: SceneData;
  frame?: number;
  onScene?: (scene: Scene) => void;
}

export function useSceneIsland({ data, frame, onScene }: SceneIslandOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const dataRef = useRef(data);
  const frameRef = useRef(frame);
  const onSceneRef = useRef(onScene);

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
