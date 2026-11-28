import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  APP_STATE_VERSION,
  addArchiveRoot,
  applyAppState,
  emptyAppState,
  parseAppState,
  rememberOpenedFile,
  removeArchiveRoot,
  serializeAppState,
} from '../src/appstate.js';
import { DEFAULT_CONFIG, settingsPatchOf } from 'drone-path-engine/config';
import type { HudLayout } from 'drone-path-engine/config';
import { testConfig } from '../../../test/fixtures/engine.js';
import { APP_STATE_SETTINGS, stateFixture } from './appstate-fixture.js';

const HUD_CASES: Array<[string, HudLayout]> = [
  ['no chip', { heading: false, alt: false, speed: false }],
  ['one chip', { heading: true, alt: false, speed: false }],
  ['two chips', { heading: false, alt: true, speed: true }],
  ['every chip', { heading: true, alt: true, speed: true }],
];

const INVALID_CASES: Array<[string, unknown]> = [
  ['a non-object', 'nope'],
  ['an array', [1, 2]],
  ['a missing version', { settings: {} }],
  ['an outdated version', { version: 3, settings: {} }],
  ['an unknown top-level key', { version: APP_STATE_VERSION, cache: 'x' }],
  [
    'an unknown settings key',
    { version: APP_STATE_VERSION, settings: { style: 'topo', bogus: 1 } },
  ],
  [
    'an invalid look value',
    { version: APP_STATE_VERSION, settings: { ...APP_STATE_SETTINGS, style: 'neon' } },
  ],
  [
    'an unreadable trail color',
    { version: APP_STATE_VERSION, settings: { ...APP_STATE_SETTINGS, trailColor: 'neon' } },
  ],
  [
    'an invalid look constraint',
    { version: APP_STATE_VERSION, settings: { ...APP_STATE_SETTINGS, zoom: -1 } },
  ],
  ['a mistyped last-opened folder', { version: APP_STATE_VERSION, lastOpenDir: 42 }],
  ['a mistyped archiveRoots field', { version: APP_STATE_VERSION, archiveRoots: 'flights' }],
  ['a null archiveRoots field', { version: APP_STATE_VERSION, archiveRoots: null }],
  ['an archiveRoots entry that is not a string', { version: APP_STATE_VERSION, archiveRoots: [42] }],
  ['an empty archiveRoots entry', { version: APP_STATE_VERSION, archiveRoots: [''] }],
  ['a whitespace-only archiveRoots entry', { version: APP_STATE_VERSION, archiveRoots: ['   '] }],
];

describe('parseAppState / serializeAppState', () => {
  it('round-trips a full state byte-identically', () => {
    const text = serializeAppState(stateFixture());
    expect(serializeAppState(parseAppState(JSON.parse(text)))).toBe(text);
  });

  it('round-trips the last-opened folder', () => {
    const state = rememberOpenedFile(stateFixture(), path.join('recs', 'flight.mp4'));
    const text = serializeAppState(state);
    expect(parseAppState(JSON.parse(text))).toEqual(state);
  });

  it('stores the HUD spec in its config-file string spelling', () => {
    const text = serializeAppState(stateFixture());
    expect(JSON.parse(text).settings.hud).toBe('heading,alt,speed');
  });

  it.each(HUD_CASES)('round-trips the %s HUD spelling byte-identically', (_label, hud) => {
    const text = serializeAppState(stateFixture({ settings: { ...APP_STATE_SETTINGS, hud } }));
    expect(serializeAppState(parseAppState(JSON.parse(text)))).toBe(text);
  });

  it('serializes an empty state as a bare version', () => {
    expect(serializeAppState(emptyAppState())).toBe(
      `${JSON.stringify({ version: APP_STATE_VERSION }, null, 2)}\n`,
    );
  });

  it('treats a bare version as the fresh state', () => {
    expect(parseAppState({ version: APP_STATE_VERSION })).toEqual(emptyAppState());
  });

  it.each(INVALID_CASES)('rejects %s instead of trusting it', (_label, raw) => {
    expect(() => parseAppState(raw)).toThrow();
  });
});

describe('tolerant settings reading', () => {
  const V1_SETTINGS = {
    style: 'topo',
    view: 'overview',
    zoom: 16,
    zoomOut: 2,
    hud: 'heading,alt,speed',
    introSec: 1.5,
    outroSec: 0,
  };

  it('loads a v1 state without encoder settings or a trail color at the defaults', () => {
    const state = parseAppState({ version: 1, settings: V1_SETTINGS });
    expect(state.settings).toEqual({
      ...APP_STATE_SETTINGS,
      trailColor: null,
      codec: 'h264',
      quality: 'high',
      preset: 'medium',
    });
  });

  it('reads an explicit null trail color as the theme default', () => {
    const state = parseAppState({ version: 1, settings: { ...V1_SETTINGS, trailColor: null } });
    expect(state.settings?.trailColor).toBeNull();
  });

  it('loads a minimal settings object with every setting at its default', () => {
    const state = parseAppState({ version: 1, settings: {} });
    expect(state.settings).toEqual(settingsPatchOf(DEFAULT_CONFIG));
  });

  it('still fails the state on a present-but-null value', () => {
    expect(() =>
      parseAppState({ version: 1, settings: { ...V1_SETTINGS, zoom: null } }),
    ).toThrow();
  });

  it('round-trips a completed state byte-identically', () => {
    const text = serializeAppState(parseAppState({ version: 1, settings: V1_SETTINGS }));
    expect(serializeAppState(parseAppState(JSON.parse(text)))).toBe(text);
  });
});

describe('applyAppState', () => {
  it('leaves the resolved config alone when nothing is persisted', () => {
    const config = testConfig();
    expect(applyAppState(config, emptyAppState())).toEqual(config);
  });

  it('restores the persisted look over the resolved config', () => {
    const config = testConfig();
    const merged = applyAppState(config, stateFixture());
    expect(settingsPatchOf(merged)).toEqual(APP_STATE_SETTINGS);
    expect(merged.workers).toBe(config.workers);
    expect(merged.outDir).toBe(config.outDir);
    expect(merged.tileCache).toBe(config.tileCache);
  });

  it('copies the hud spec so no two configs share it', () => {
    const state = stateFixture();
    const merged = applyAppState(testConfig(), state);
    merged.hud.heading = false;
    expect(state.settings?.hud.heading).toBe(true);
    expect(merged.hud).not.toBe(state.settings?.hud);
  });
});

describe('rememberOpenedFile', () => {
  it('stores the folder of the picked recording', () => {
    const dir = path.join('tmp', 'flights');
    const next = rememberOpenedFile(emptyAppState(), path.join(dir, 'flight.mp4'));
    expect(next.lastOpenDir).toBe(dir);
  });

  it('keeps the persisted look while moving the folder', () => {
    const next = rememberOpenedFile(stateFixture(), path.join('recs', 'flight.mp4'));
    expect(next.settings).toEqual(APP_STATE_SETTINGS);
    expect(next.lastOpenDir).toBe('recs');
  });
});

describe('archiveRoots persistence and helpers', () => {
  it('omits archiveRoots when empty and round-trips non-empty normalized roots', () => {
    const emptyText = serializeAppState(emptyAppState());
    expect(JSON.parse(emptyText)).not.toHaveProperty('archiveRoots');

    const rootA = path.resolve('flights', 'day1');
    const rootB = path.resolve('flights', 'day2');
    const state = stateFixture({ archiveRoots: [rootA, rootB] });
    const serialized = serializeAppState(state);
    expect(JSON.parse(serialized).archiveRoots).toEqual([rootA, rootB]);
    expect(parseAppState(JSON.parse(serialized))).toEqual(state);
  });

  it('deduplicates and normalizes archiveRoots when parsing', () => {
    const raw = {
      version: APP_STATE_VERSION,
      archiveRoots: [path.join('flights', 'a', '.'), path.join('flights', 'a'), path.join('flights', 'b')],
    };
    const parsed = parseAppState(raw);
    expect(parsed.archiveRoots).toEqual([path.resolve('flights', 'a'), path.resolve('flights', 'b')]);
  });

  it('adds and removes archiveRoots purely', () => {
    const dirA = path.resolve('flights', 'a');
    const dirB = path.resolve('flights', 'b');
    const s1 = addArchiveRoot(emptyAppState(), dirA);
    expect(s1.archiveRoots).toEqual([dirA]);
    const s2 = addArchiveRoot(s1, `${dirA}${path.sep}`);
    expect(s2.archiveRoots).toEqual([dirA]);
    const s3 = addArchiveRoot(s2, dirB);
    expect(s3.archiveRoots).toEqual([dirA, dirB]);
    const s4 = removeArchiveRoot(s3, dirA);
    expect(s4.archiveRoots).toEqual([dirB]);
    expect(() => addArchiveRoot(emptyAppState(), '  ')).toThrow('archive root must be a non-empty path');
  });
});
