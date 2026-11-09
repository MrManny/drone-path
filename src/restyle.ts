import type { LookSettings } from './config.js';
import type { Bbox } from './geo.js';
import { buildSceneData, planPageOpts } from './page.js';
import type { SceneData } from './renderer/scene.js';

export interface RestyleMeta {
  /** Frames per second and total count of the probed source. */
  fps: number;
  frames: number;
  /** Where the consumer serves tiles from ("/tiles", "app://bundle/tiles"). */
  tileBase: string;
  /** The telemetry's fix bbox - the same one the pipeline plans from. */
  bbox: Bbox;
}

export function restyleSceneData(
  prev: SceneData,
  config: LookSettings,
  meta: RestyleMeta,
  // The output size to plan at: the export preview plans at the size the
  // pipeline will render, while the player keeps the prepared scene's own.
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
