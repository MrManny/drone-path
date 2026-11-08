import { describe, expect, it, vi } from 'vitest';

import {
  createAppSession,
  frameExactDuration,
  parsePickRequest,
  prepareUiSession,
} from '../src/appsession.js';
import type { PickRequest, PrepareUiSession, UiSession } from '../src/appsession.js';
import type { RenderConfig } from '../src/config.js';
import type { PrepareProgress } from '../src/run.js';
import type { PrefetchStats, WarmOptions } from '../src/tiles.js';
import {
  cleanupTmpDirs,
  probeFixture,
  stubDeps,
  telemetryFixture,
  testConfig,
  tmpDir,
} from './fixtures.js';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach } from 'vitest';

const CONFIG = {} as RenderConfig;
const SESSION = { scene: {}, video: {} } as unknown as UiSession;

const REQUEST: PickRequest = {
  settings: {
    style: 'satellite',
    view: 'overview',
    zoom: 0,
    zoomOut: 0,
    hud: { heading: true, alt: false, speed: false },
    introSec: 0,
    outroSec: 0,
  },
};

const PROBE = probeFixture({
  fps: { num: 30000, den: 1001, value: 29.97, str: '30000/1001' },
  frames: 300,
  durationSec: 10.01,
  width: 1920,
  height: 1080,
});

describe('frameExactDuration', () => {
  it('takes the duration from the frame-exact count and rate', () => {
    expect(frameExactDuration(PROBE)).toBe(300 / 29.97);
  });

  it('ignores the container duration the probe reports alongside', () => {
    const probe = {
      ...PROBE,
      fps: { num: 30, den: 1, value: 30, str: '30' },
      frames: 90,
    };
    expect(frameExactDuration(probe)).toBe(3);
    expect(probe.durationSec).not.toBe(3);
  });
});

function mp4(name = 'clip.mp4'): string {
  const file = path.join(tmpDir(), name);
  fs.writeFileSync(file, Buffer.from('video'));
  return file;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanupTmpDirs();
});

describe('createAppSession', () => {
  it('prepares a picked recording and holds its session', async () => {
    const file = mp4();
    const prepare = vi.fn(async (): Promise<UiSession> => SESSION);
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare });

    expect(await session.pick(REQUEST)).toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledWith(
      file,
      { ...CONFIG, ...REQUEST.settings },
      expect.any(Function),
      expect.any(Function),
    );
    expect(session.getSession()).toBe(SESSION);
    expect(session.videoPath()).toBe(file);
  });

  it('reports a canceled dialog', async () => {
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => null,
      prepare: vi.fn(),
    });
    expect(await session.pick(REQUEST)).toEqual({ ok: false, canceled: true });
    expect(session.getSession()).toBeNull();
  });

  it('rejects non-mp4 picks', async () => {
    const file = path.join(tmpDir(), 'clip.mov');
    fs.writeFileSync(file, Buffer.from('video'));
    const prepare = vi.fn();
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare });
    const result = await session.pick(REQUEST);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a readable .mp4 file');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects a missing file', async () => {
    const missing = path.join(tmpDir(), 'gone.mp4');
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => missing,
      prepare: vi.fn(),
    });
    expect((await session.pick(REQUEST)).error).toContain('not a readable .mp4 file');
  });

  it('surfaces preparation failures and keeps no session', async () => {
    const file = mp4();
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => file,
      prepare: vi.fn(async () => {
        throw new Error('probe failed');
      }),
    });
    const result = await session.pick(REQUEST);
    expect(result).toEqual({ ok: false, error: 'probe failed' });
    expect(session.getSession()).toBeNull();
    expect(session.videoPath()).toBeNull();
  });

  it('keeps the previous session when a new pick fails', async () => {
    const first = mp4('first.mp4');
    const prepare = vi.fn(async (): Promise<UiSession> => SESSION);
    let pickFile = async (): Promise<string | null> => first;
    const session = createAppSession({ config: CONFIG, pickFile: () => pickFile(), prepare });
    await session.pick(REQUEST);
    pickFile = async (): Promise<string | null> => null;
    await session.pick(REQUEST);
    expect(session.getSession()).toBe(SESSION);
    expect(session.videoPath()).toBe(first);
  });

  it('refuses a pick while another is in progress', async () => {
    const file = mp4();
    // An assertion initializer: the resolver runs inside the Promise executor,
    // and control-flow analysis cannot see assignments made in closures.
    let release = null as ((value: UiSession) => void) | null;
    const prepare = vi.fn(
      () =>
        new Promise<UiSession>((resolve) => {
          release = resolve;
        }),
    );
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare });

    const first = session.pick(REQUEST);
    const second = await session.pick(REQUEST);
    expect(second).toEqual({ ok: false, error: 'a pick is already in progress' });
    if (release) release(SESSION);
    expect(await first).toEqual({ ok: true });
  });
});

describe('createAppSession onPreparing hook', () => {
  it('fires once with the picked path, before preparation starts', async () => {
    const file = mp4();
    const order: string[] = [];
    const onPreparing = vi.fn((videoPath: string) => {
      order.push(`preparing ${videoPath}`);
    });
    const prepare = vi.fn(async (): Promise<UiSession> => {
      order.push('prepare');
      return SESSION;
    });
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare, onPreparing });

    expect(await session.pick(REQUEST)).toEqual({ ok: true });
    expect(onPreparing).toHaveBeenCalledTimes(1);
    expect(order).toEqual([`preparing ${file}`, 'prepare']);
  });

  it('stays silent when the dialog is canceled', async () => {
    const onPreparing = vi.fn();
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => null,
      prepare: vi.fn(),
      onPreparing,
    });
    expect(await session.pick(REQUEST)).toEqual({ ok: false, canceled: true });
    expect(onPreparing).not.toHaveBeenCalled();
  });

  it('stays silent when the dialog itself fails', async () => {
    const onPreparing = vi.fn();
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => {
        throw new Error('dialog unavailable');
      },
      prepare: vi.fn(),
      onPreparing,
    });
    expect(await session.pick(REQUEST)).toEqual({ ok: false, error: 'dialog unavailable' });
    expect(onPreparing).not.toHaveBeenCalled();
  });

  it('stays silent for a file that is not a readable recording', async () => {
    const file = path.join(tmpDir(), 'clip.mov');
    fs.writeFileSync(file, Buffer.from('video'));
    const onPreparing = vi.fn();
    const prepare = vi.fn();
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare, onPreparing });
    expect((await session.pick(REQUEST)).ok).toBe(false);
    expect(onPreparing).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('createAppSession onPrepareProgress hook', () => {
  const reported: PrepareProgress = {
    stage: 'plan',
    done: 2,
    total: 3,
  };

  it('hands the hook to preparation and forwards its reports', async () => {
    const file = mp4();
    const onPrepareProgress = vi.fn();
    const prepare = vi.fn<PrepareUiSession>(async (_file, _config, _log, onProgress) => {
      onProgress?.(reported);
      return SESSION;
    });
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => file,
      prepare,
      onPrepareProgress,
    });

    expect(await session.pick(REQUEST)).toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledWith(
      file,
      { ...CONFIG, ...REQUEST.settings },
      expect.any(Function),
      onPrepareProgress,
    );
    expect(onPrepareProgress).toHaveBeenCalledTimes(1);
    expect(onPrepareProgress).toHaveBeenCalledWith(reported);
  });

  it('stays silent when the pick is rejected before preparation', async () => {
    const onPrepareProgress = vi.fn();
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => null,
      prepare: vi.fn(),
      onPrepareProgress,
    });
    expect(await session.pick(REQUEST)).toEqual({ ok: false, canceled: true });
    expect(onPrepareProgress).not.toHaveBeenCalled();
  });
});

describe('parsePickRequest', () => {
  const settings = {
    style: 'topo',
    view: 'follow',
    zoom: 12,
    zoomOut: 2,
    hud: { heading: false, alt: true, speed: true },
    introSec: 1.5,
    outroSec: 0,
  };

  it('takes the look settings off the renderer request', () => {
    expect(parsePickRequest({ settings })).toEqual({ settings });
  });

  it('rejects an unknown map style', () => {
    expect(() => parsePickRequest({ settings: { ...settings, style: 'paper' } })).toThrow(
      'unknown map style: paper',
    );
  });

  it('rejects an unknown view', () => {
    expect(() => parsePickRequest({ settings: { ...settings, view: 'chase' } })).toThrow(
      'unknown view: chase',
    );
  });

  it('rejects non-numeric and negative values', () => {
    expect(() => parsePickRequest({ settings: { ...settings, zoom: 'high' } })).toThrow();
    expect(() => parsePickRequest({ settings: { ...settings, zoom: -1 } })).toThrow(
      'zoom must be >= 0',
    );
    expect(() => parsePickRequest({ settings: { ...settings, zoomOut: -1 } })).toThrow(
      'zoom-out must be >= 0',
    );
    expect(() => parsePickRequest({ settings: { ...settings, introSec: -1 } })).toThrow(
      'intro must be 0 or more',
    );
    expect(() => parsePickRequest({ settings: { ...settings, outroSec: -1 } })).toThrow(
      'outro must be 0 or more',
    );
  });

  it('rejects junk payloads', () => {
    expect(() => parsePickRequest(null)).toThrow('unknown map style');
    expect(() => parsePickRequest({})).toThrow('unknown map style');
  });
});

describe('prepareUiSession', () => {
  it('runs probe, telemetry and the view plan without waiting for tiles', async () => {
    const prefetchTiles = vi.fn(
      async ({ tiles }: WarmOptions): Promise<PrefetchStats> => ({
        downloaded: tiles.length,
        failed: 0,
        total: tiles.length,
      }),
    );
    const events: PrepareProgress[] = [];
    const config = testConfig();

    const ui = await prepareUiSession(
      'clips/flight.mp4',
      config,
      () => {},
      (progress) => events.push(progress),
      stubDeps({ prefetchTiles }),
    );

    // The app path never prefetches: the map fetches its tiles on demand.
    expect(prefetchTiles).not.toHaveBeenCalled();
    expect(events.map((e) => e.stage)).toEqual(['probe', 'telemetry', 'plan']);
    expect(ui.bbox).toEqual(telemetryFixture().bbox);
    expect(ui.video.frames).toBe(probeFixture().frames);
    expect(ui.video.src).toContain('video');
  });

  it('fails the preparation when a stage fails', async () => {
    await expect(
      prepareUiSession(
        'clips/flight.mp4',
        testConfig(),
        () => {},
        undefined,
        stubDeps({
          loadTelemetry: async () => {
            throw new Error('telemetry unreadable');
          },
        }),
      ),
    ).rejects.toThrow('telemetry unreadable');
  });
});
