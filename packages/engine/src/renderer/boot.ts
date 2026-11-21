import type { LeafletApi, Scene, SceneData } from './scene.js';
import { createScene } from './scene.js';

export function bootScene(
  host: HTMLElement,
  data: SceneData,
  L: LeafletApi,
  opts?: { hudHost?: HTMLElement },
): Scene {
  const scene = createScene(host, data, { L, hudHost: opts?.hudHost });
  let disposed = false;
  let rafId: number | undefined;
  const baseDispose = scene.dispose.bind(scene);
  const booted: Scene = {
    setFrame: (i) => scene.setFrame(i),
    relayout: () => scene.relayout(),
    update: (next) => scene.update(next),
    ready: scene.ready,
    dispose: () => {
      disposed = true;
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        rafId = undefined;
      }
      baseDispose();
    },
  };
  // The pane size may only settle after creation; re-measure post-layout.
  rafId = requestAnimationFrame(() => {
    rafId = undefined;
    if (!disposed) booted.relayout();
  });
  return booted;
}
