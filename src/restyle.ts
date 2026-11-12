import type { AppearanceSettings } from './config.js';
import type { Bbox } from './geo.js';
import { buildSceneData, planPageOpts } from './render-page.js';
import type { SceneData } from './renderer/scene.js';

export interface RestyleMeta {
  fps: number;
  frames: number;
  tileBase: string;
  bbox: Bbox;
}

export function restyleSceneData(
  prev: SceneData,
  config: AppearanceSettings,
  meta: RestyleMeta,
  size: { width: number; height: number } = { width: prev.width, height: prev.height },
): SceneData {
  const planned = planPageOpts({
    bbox: meta.bbox,
    width: size.width,
    height: size.height,
    config,
    source: { fps: meta.fps, frames: meta.frames },
    frames: prev,
    previous: {
      zoom: prev.zoom,
      decimated: { lat: prev.trailLat, lon: prev.trailLon, frame: prev.trailFrame },
    },
  });
  return buildSceneData(planned, meta.tileBase);
}
