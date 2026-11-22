import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG, settingsPatchOf } from 'drone-path-engine/config';
import type { SettingsPatch } from 'drone-path-engine/config';
import type { AppState } from '../src/appstate.js';
import {
  applyAppState,
  emptyAppState,
  rememberOpenedFile,
  serializeAppState,
} from '../src/appstate.js';
import {
  createAppStateStore,
  nodeExportIo,
  nodeSessionIo,
  readAppState,
  resolveDesktopConfig,
  saveAppStateSafely,
  writeAppState,
} from '../src/shellio.js';
import { testConfig } from '../../../test/fixtures/engine.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTmpDirs();
});

const PATCH: SettingsPatch = {
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

function stateFixture(overrides: Partial<AppState> = {}): AppState {
  return { settings: PATCH, lastOpenDir: null, language: null, ...overrides };
}

const UNREADABLE_CASES: Array<[string, string]> = [
  ['corrupt JSON', '{oops'],
  ['a JSON scalar', '42'],
  ['a valid JSON value with the wrong shape', '{"version":3}'],
];

describe('readAppState', () => {
  it('is a fresh state when no file exists (fresh install)', () => {
    expect(readAppState(path.join(tmpDir(), 'state.json'))).toEqual(emptyAppState());
  });

  it.each(UNREADABLE_CASES)('falls back to the fresh state for %s', (_label, text) => {
    const file = path.join(tmpDir(), 'state.json');
    fs.writeFileSync(file, text);
    expect(readAppState(file)).toEqual(emptyAppState());
  });

  it('round-trips a state through the file', () => {
    const file = path.join(tmpDir(), 'state.json');
    writeAppState(file, stateFixture());
    expect(readAppState(file)).toEqual(stateFixture());
  });
});

describe('writeAppState / saveAppStateSafely / createAppStateStore', () => {
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

  it('logs write errors in saveAppStateSafely instead of throwing', () => {
    const blocker = path.join(tmpDir(), 'blocker');
    fs.writeFileSync(blocker, 'x');
    const log = vi.fn();
    expect(() => saveAppStateSafely(path.join(blocker, 'state.json'), emptyAppState(), log)).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('app state not saved:'));
  });

  it('persists and restores settings and lastOpenDir through createAppStateStore', () => {
    const file = path.join(tmpDir(), 'state.json');
    const dir = tmpDir();
    const store = createAppStateStore(file, vi.fn());
    store.write(rememberOpenedFile(stateFixture(), path.join(dir, 'flight.mp4')));
    const restored = store.read();
    expect(restored.lastOpenDir).toBe(dir);
    expect(settingsPatchOf(applyAppState(testConfig(), restored))).toEqual(PATCH);
  });
});

describe('nodeSessionIo and nodeExportIo', () => {
  it('checks regular files and manages working export files on disk', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'clip.mp4');
    fs.writeFileSync(file, 'video');
    expect(nodeSessionIo.isFile(file)).toBe(true);
    expect(nodeSessionIo.isFile(dir)).toBe(false);
    expect(nodeSessionIo.isFile(path.join(dir, 'missing.mp4'))).toBe(false);

    const partial = path.join(dir, 'out.partial.mp4');
    const target = path.join(dir, 'out.mp4');
    fs.writeFileSync(partial, 'rendered');
    expect(nodeExportIo.exists(partial)).toBe(true);
    nodeExportIo.rename(partial, target);
    expect(nodeExportIo.exists(partial)).toBe(false);
    expect(nodeExportIo.exists(target)).toBe(true);
    nodeExportIo.remove(target);
    expect(nodeExportIo.exists(target)).toBe(false);
  });
});

describe('resolveDesktopConfig (#401)', () => {
  it('ignores .dronepath.json in process.cwd() and its ancestor directories', () => {
    const cwdRoot = tmpDir();
    const nestedCwd = path.join(cwdRoot, 'Downloads');
    fs.mkdirSync(nestedCwd, { recursive: true });
    fs.writeFileSync(
      path.join(cwdRoot, '.dronepath.json'),
      JSON.stringify({ ffmpeg: '/evil/parent-ffmpeg', browser: '/evil/parent-browser' }),
    );
    fs.writeFileSync(
      path.join(nestedCwd, '.dronepath.json'),
      JSON.stringify({ ffmpeg: '/evil/cwd-ffmpeg', ffprobe: '/evil/cwd-ffprobe' }),
    );
    vi.spyOn(process, 'cwd').mockReturnValue(nestedCwd);

    const userRoot = tmpDir();
    const userDir = path.join(userRoot, 'drone-path');
    fs.mkdirSync(userDir, { recursive: true });
    // Even an ancestor of userDir must not be discovered.
    fs.writeFileSync(
      path.join(userRoot, '.dronepath.json'),
      JSON.stringify({ ffmpeg: '/evil/user-parent-ffmpeg' }),
    );

    const resolved = resolveDesktopConfig(userDir);
    expect(resolved.configPath).toBeNull();
    expect(resolved.config.ffmpeg).toBeNull();
    expect(resolved.config.ffprobe).toBeNull();
    expect(resolved.config.browser).toBeNull();
    expect(resolved.config.outDir).toBe(DEFAULT_CONFIG.outDir);
  });

  it('loads .dronepath.json only when placed directly inside userDataDir and keeps relative outDir', () => {
    const userDir = tmpDir();
    const userConfig = path.join(userDir, '.dronepath.json');
    fs.writeFileSync(userConfig, JSON.stringify({ style: 'topo', workers: 2 }));

    const omittedOutDir = resolveDesktopConfig(userDir);
    expect(omittedOutDir.configPath).toBe(userConfig);
    expect(omittedOutDir.config.style).toBe('topo');
    expect(omittedOutDir.config.workers).toBe(2);
    expect(omittedOutDir.config.outDir).toBe(DEFAULT_CONFIG.outDir);

    fs.writeFileSync(userConfig, JSON.stringify({ outDir: 'renders' }));
    expect(resolveDesktopConfig(userDir).config.outDir).toBe('renders');

    fs.writeFileSync(userConfig, JSON.stringify({ outDir: null }));
    expect(resolveDesktopConfig(userDir).config.outDir).toBeNull();
  });
});
