import { describe, expect, it } from 'vitest';

import type { UiSession } from '../../src/appsession.js';
import { restyleMeta } from '../../ui/lib/restylemeta.js';

const SESSION = {
  video: { src: 'app://bundle/media/video', fps: 30, frames: 300, width: 1280, height: 720 },
  tileBase: 'app://bundle/tiles',
  bbox: { minLat: 46.605, maxLat: 46.615, minLon: 14.255, maxLon: 14.265 },
} as unknown as UiSession;

describe('restyleMeta', () => {
  it('takes the rate and count from the video and the tiles and bbox from the session', () => {
    expect(restyleMeta(SESSION)).toEqual({
      fps: 30,
      frames: 300,
      tileBase: 'app://bundle/tiles',
      bbox: { minLat: 46.605, maxLat: 46.615, minLon: 14.255, maxLon: 14.265 },
    });
  });
});
