import type { UiSession } from '../../src/appsession.js';
import type { RestyleMeta } from 'drone-path-engine/restyle';

export function restyleMeta(session: UiSession): RestyleMeta {
  return {
    fps: session.video.fps,
    frames: session.video.frames,
    tileBase: session.tileBase,
    bbox: session.bbox,
  };
}
