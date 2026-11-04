import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppState } from '../src/appstate.js';
import {
  APP_STATE_VERSION,
  applyAppState,
  emptyAppState,
  parseAppState,
  readAppState,
  rememberOpenedFile,
  serializeAppState,
  writeAppState,
} from '../src/appstate.js';
import { settingsPatchOf } from '../src/config.js';
import type { HudSpec, SettingsPatch } from '../src/config.js';
import { cleanupTmpDirs, testConfig, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

const PATCH: SettingsPatch = {
  style: 'topo',
  view: 'overview',
  zoom: 16,
  zoomOut: 2,
  hud: { heading: true, alt: true, speed: true },
  introSec: 1.5,
  outroSec: 0,
};

function stateFixture(overrides: Partial<AppState> = {}): AppState {
  return { settings: PATCH, lastOpenDir: null, ...overrides };
}

const HUD_CASES: Array<[string, HudSpec]> = [
  ['no chip', { heading: false, alt: false, speed: false }],
  ['one chip', { heading: true, alt: false, speed: false }],
  ['two chips', { heading: false, alt: true, speed: true }],
  ['every chip', { heading: true, alt: true, speed: true }],
];

const INVALID_CASES: Array<[string, unknown]> = [
  ['a non-object', 'nope'],
  ['an array', [1, 2]],
  ['a missing version', { settings: {} }],
  ['an outdated version', { version: 2, settings: {} }],
  ['an unknown top-level key', { version: APP_STATE_VERSION, cache: 'x' }],
  [
    'an unknown settings key',
    { version: APP_STATE_VERSION, settings: { style: 'topo', bogus: 1 } },
  ],
  [
    'an invalid look value',
    { version: APP_STATE_VERSION, settings: { ...PATCH, style: 'neon' } },
  ],
  [
    'an invalid look constraint',
    { version: APP_STATE_VERSION, settings: { ...PATCH, zoom: -1 } },
  ],
  ['an incomplete look', { version: APP_STATE_VERSION, settings: { style: 'topo' } }],
  ['a mistyped last-opened folder', { version: APP_STATE_VERSION, lastOpenDir: 42 }],
];

const UNREADABLE_CASES: Array<[string, string]> = [
  ['corrupt JSON', '{oops'],
  ['a JSON scalar', '42'],
  ['a valid JSON value with the wrong shape', '{"version":2}'],
  ['a partial state', '{"version":1,"settings":{"style":"topo"}}'],
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
    const text = serializeAppState(stateFixture({ settings: { ...PATCH, hud } }));
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

describe('readAppState', () => {
  it('is a fresh state when no file exists (fresh install)', () => {
    expect(readAppState(path.join(tmpDir(), 'state.json'))).toEqual(emptyAppState());
  });

  it.each(UNREADABLE_CASES)(
    'falls back to the fresh state for %s',
    (_label, text) => {
      const file = path.join(tmpDir(), 'state.json');
      fs.writeFileSync(file, text);
      expect(readAppState(file)).toEqual(emptyAppState());
    },
  );

  it('round-trips a state through the file', () => {
    const file = path.join(tmpDir(), 'state.json');
    writeAppState(file, stateFixture());
    expect(readAppState(file)).toEqual(stateFixture());
  });
});

describe('writeAppState', () => {
  it('creates the file and its directory with deterministic bytes', () => {
    const file = path.join(tmpDir(), 'nested', 'state.json');
    writeAppState(file, stateFixture());
    expect(fs.readFileSync(file, 'utf8')).toBe(serializeAppState(stateFixture()));
  });

  it('wraps write failures with the original cause', () => {
    const blocker = path.join(tmpDir(), 'blocker');
    fs.writeFileSync(blocker, 'x');
    try {
      writeAppState(path.join(blocker, 'state.json'), emptyAppState());
      expect.unreachable('writing under a file must fail');
    } catch (e) {
      expect((e as Error).message).toMatch(/^cannot write app state /);
      expect((e as Error).cause).toBeInstanceOf(Error);
    }
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
    expect(settingsPatchOf(merged)).toEqual(PATCH);
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
    const dir = tmpDir();
    const next = rememberOpenedFile(emptyAppState(), path.join(dir, 'flight.mp4'));
    expect(next.lastOpenDir).toBe(dir);
  });

  it('keeps the persisted look while moving the folder', () => {
    const next = rememberOpenedFile(stateFixture(), path.join('recs', 'flight.mp4'));
    expect(next.settings).toEqual(PATCH);
    expect(next.lastOpenDir).toBe('recs');
  });
});

describe('settings persistence across a relaunch', () => {
  it('restores the panel look through the state file', () => {
    const file = path.join(tmpDir(), 'state.json');
    writeAppState(file, stateFixture());
    const restored = applyAppState(testConfig(), readAppState(file));
    expect(settingsPatchOf(restored)).toEqual(PATCH);
  });

  it('restores the last-opened folder and the look together', () => {
    const file = path.join(tmpDir(), 'state.json');
    const dir = tmpDir();
    writeAppState(file, rememberOpenedFile(stateFixture(), path.join(dir, 'flight.mp4')));
    const restored = readAppState(file);
    expect(restored.lastOpenDir).toBe(dir);
    expect(applyAppState(testConfig(), restored).style).toBe('topo');
  });
});
