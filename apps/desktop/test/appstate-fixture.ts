import type { SettingsPatch } from 'drone-path-engine/config';

import type { AppState } from '../src/appstate.js';

export const APP_STATE_SETTINGS: SettingsPatch = {
  style: 'topo',
  view: 'overview',
  zoom: 16,
  zoomOut: 2,
  hud: { heading: true, alt: true, speed: true },
  introSec: 1.5,
  outroSec: 0,
  trailColor: '#e63946',
  codec: 'h265',
  quality: 'low',
  preset: 'veryfast',
};

export function stateFixture(overrides: Partial<AppState> = {}): AppState {
  return { settings: APP_STATE_SETTINGS, lastOpenDir: null, language: null, archiveRoots: [], ...overrides };
}
