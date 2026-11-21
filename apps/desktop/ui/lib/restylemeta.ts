import type { UiSession } from '../../src/appsession.js';
import { appearanceOf } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import { restyleSceneData } from 'drone-path-engine/restyle';
import type { RestyleMeta } from 'drone-path-engine/restyle';
import type { SceneData } from 'drone-path-engine/renderer/scene';

export function restyleMeta(session: UiSession): RestyleMeta {
  return {
    fps: session.video.fps,
    frames: session.video.frames,
    tileBase: session.tileBase,
    bbox: session.bbox,
  };
}

export function restyleSession(
  session: UiSession,
  config: RenderConfig,
  size?: { width: number; height: number },
): SceneData {
  return restyleSceneData(session.scene, appearanceOf(config), restyleMeta(session), size);
}
