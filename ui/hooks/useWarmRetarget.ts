'use client';

// The background pre-warm follows the map on screen: it pivots onto what the
// map displays whenever the settings, the stage layout or the window size
// change it.

import { useEffect } from 'react';

import type { WarmRequest } from '../../src/appsession.js';
import type { RenderConfig } from '../../src/config.js';
import { settingsPatchOf } from '../../src/config.js';
import type { StageLayout } from '../lib/layout.js';
import { mapFrameSize } from '../lib/layout.js';

export function useWarmRetarget(
  retarget: ((request: WarmRequest) => void) | undefined,
  settings: RenderConfig,
  layout: StageLayout,
): void {
  useEffect(() => {
    if (!retarget) return;
    const pivot = (): void =>
      retarget({
        settings: settingsPatchOf(settings),
        frame: mapFrameSize(window.innerWidth, window.innerHeight, layout),
      });
    pivot();
    window.addEventListener('resize', pivot);
    return () => window.removeEventListener('resize', pivot);
  }, [retarget, settings, layout]);
}
