import { describe, expect, it, vi } from 'vitest';

import {
  createAppSession,
  frameExactDuration,
  parseWarmRequest,
  prepareUiSession,
} from '../src/appsession.js';
import type {
  PrepareUiSession,
  UiSession,
  WarmProgress,
  WarmRequest,
} from '../src/appsession.js';
import type { RenderConfig, SettingsPatch } from '../src/config.js';
import { displayedTiles, planView } from '../src/plan.js';
import type { PipelineDeps, PrepareProgress } from '../src/run.js';
import { createTileTraffic } from '../src/tiles.js';
import type { PrefetchOptions, PrefetchStats, TileStatus } from '../src/tiles.js';
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

const REQUEST: WarmRequest = {
  settings: {
    style: 'satellite',
    view: 'overview',
    zoom: 0,
    zoomOut: 0,
    hud: { heading: true, alt: false, speed: false },
    introSec: 0,
    outroSec: 0,
  },
  frame: { width: 480, height: 270 },
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
      REQUEST.frame,
      { prefetchTiles: expect.any(Function) },
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
    stage: 'tiles',
    done: 3,
    total: 51,
    tilesDone: 0,
    tilesTotal: 48,
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
      REQUEST.frame,
      { prefetchTiles: expect.any(Function) },
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

describe('parseWarmRequest', () => {
  const settings = {
    style: 'topo',
    view: 'follow',
    zoom: 12,
    zoomOut: 2,
    hud: { heading: false, alt: true, speed: true },
    introSec: 1.5,
    outroSec: 0,
  };

  it('takes the look settings and the frame off the renderer request', () => {
    expect(parseWarmRequest({ settings, frame: { width: 640, height: 360 } })).toEqual({
      settings,
      frame: { width: 640, height: 360 },
    });
  });

  it('rejects an unknown map style', () => {
    expect(() =>
      parseWarmRequest({
        settings: { ...settings, style: 'paper' },
        frame: { width: 640, height: 360 },
      }),
    ).toThrow('unknown map style: paper');
  });

  it('rejects an unknown view', () => {
    expect(() =>
      parseWarmRequest({
        settings: { ...settings, view: 'chase' },
        frame: { width: 640, height: 360 },
      }),
    ).toThrow('unknown view: chase');
  });

  it('rejects non-numeric and negative values', () => {
    const frame = { width: 640, height: 360 };
    expect(() => parseWarmRequest({ settings: { ...settings, zoom: 'high' }, frame })).toThrow();
    expect(() => parseWarmRequest({ settings: { ...settings, zoom: -1 }, frame })).toThrow(
      'zoom must be >= 0',
    );
    expect(() => parseWarmRequest({ settings: { ...settings, zoomOut: -1 }, frame })).toThrow(
      'zoom-out must be >= 0',
    );
    expect(() => parseWarmRequest({ settings: { ...settings, introSec: -1 }, frame })).toThrow(
      'intro must be 0 or more',
    );
  });

  it('rejects a missing or empty frame', () => {
    expect(() => parseWarmRequest({ settings })).toThrow('frame width');
    expect(() =>
      parseWarmRequest({ settings, frame: { width: 0, height: 360 } }),
    ).toThrow('frame size must be positive');
  });

  it('rejects junk payloads', () => {
    expect(() => parseWarmRequest(null)).toThrow('unknown map style');
  });
});

describe('createAppSession background pre-warm', () => {
  const WARM_SESSION = {
    scene: { width: 768, height: 768 },
    video: {},
    tileBase: 'app://bundle/tiles',
    bbox: { minLat: 46.6, maxLat: 46.62, minLon: 14.2, maxLon: 14.22 },
    durationSec: 1,
  } as unknown as UiSession;

  const SETTINGS: SettingsPatch = {
    style: 'satellite',
    view: 'overview',
    zoom: 0,
    zoomOut: 0,
    hud: { heading: true, alt: false, speed: false },
    introSec: 0,
    outroSec: 0,
  };
  const TOPO: SettingsPatch = { ...SETTINGS, style: 'topo' };
  const FRAME = { width: 480, height: 270 };
  const SAT: WarmRequest = { settings: SETTINGS, frame: FRAME };
  const TOPO_PLAN: WarmRequest = { settings: TOPO, frame: FRAME };

  const tilesOf = (request: WarmRequest): unknown[] =>
    displayedTiles(
      WARM_SESSION.bbox,
      planView(WARM_SESSION.bbox, 768, 768, request.settings).zoom,
      request.frame,
      request.settings,
    );

  // The warm stream emits from a microtask; one timer turn sees them all.
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  function warmHarness(streamTiles?: (options: PrefetchOptions) => Promise<PrefetchStats>) {
    const calls: PrefetchOptions[] = [];
    const progress: WarmProgress[] = [];
    const logs: string[] = [];
    const pending: { options: PrefetchOptions; resolve: (stats: PrefetchStats) => void }[] = [];
    const stream =
      streamTiles ??
      vi.fn(
        (options: PrefetchOptions) =>
          new Promise<PrefetchStats>((resolve) => {
            pending.push({ options, resolve });
          }),
      );
    const session = createAppSession({
      config: { tileCache: tmpDir() } as RenderConfig,
      pickFile: async () => mp4(),
      prepare: vi.fn(async (): Promise<UiSession> => WARM_SESSION),
      log: (msg) => logs.push(msg),
      streamTiles: (options) => {
        calls.push(options);
        return stream(options);
      },
      onWarmProgress: (p) => progress.push(p),
    });
    return { session, calls, progress, logs, pending };
  }

  it('streams the plan these settings describe and counts every settled tile', async () => {
    const { session, calls, progress, pending } = warmHarness();
    await session.pick(REQUEST);
    session.warm.retarget(SAT);
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].style).toBe('satellite');
    expect(calls[0].tiles).toEqual(tilesOf(SAT));
    expect(progress).toEqual([{ done: 0, total: tilesOf(SAT).length }]);

    const settle = calls[0].onTile as (status: TileStatus) => void;
    settle('cached');
    settle('downloaded');
    await flush();
    expect(progress[progress.length - 1]).toEqual({
      done: 2,
      total: tilesOf(SAT).length,
    });
    pending[0].resolve({ downloaded: 1, failed: 0, total: calls[0].tiles.length });
  });

  it('ignores a pivot onto the plan already streaming', async () => {
    const { session, calls } = warmHarness();
    await session.pick(REQUEST);
    session.warm.retarget(SAT);
    session.warm.retarget({ settings: { ...SETTINGS }, frame: { ...FRAME } });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('pivots onto a new plan, drops the old one and restarts the count', async () => {
    const { session, calls, progress, pending } = warmHarness();
    await session.pick(REQUEST);
    session.warm.retarget(SAT);
    await flush();
    (calls[0].onTile as (status: TileStatus) => void)('cached');
    await flush();

    session.warm.retarget(TOPO_PLAN);
    await flush();

    // The old downloads are dropped and its late settles stop counting.
    expect(calls[0].signal?.aborted).toBe(true);
    (calls[0].onTile as (status: TileStatus) => void)('downloaded');
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].tiles).toEqual(tilesOf(TOPO_PLAN));
    expect(progress).toEqual([
      { done: 0, total: tilesOf(SAT).length },
      { done: 1, total: tilesOf(SAT).length },
      { done: 0, total: tilesOf(TOPO_PLAN).length },
    ]);
    for (const call of pending) call.resolve({ downloaded: 0, failed: 0, total: 1 });
  });

  it('clears the hint when the stream dies and logs why', async () => {
    const { session, progress, logs } = warmHarness(async () => {
      throw new Error('cache unwritable');
    });
    await session.pick(REQUEST);
    session.warm.retarget(SAT);
    await flush();

    expect(progress[progress.length - 1]).toEqual({ done: 0, total: 0 });
    expect(logs.some((line) => line.includes('cache unwritable'))).toBe(true);
  });

  it('drops the stream when another recording is picked', async () => {
    const { session, calls, progress, pending } = warmHarness();
    await session.pick(REQUEST);
    session.warm.retarget(SAT);
    await flush();

    await session.pick(REQUEST);
    await flush();

    expect(calls[0].signal?.aborted).toBe(true);
    expect(progress[progress.length - 1]).toEqual({ done: 0, total: 0 });
    for (const call of pending) call.resolve({ downloaded: 0, failed: 0, total: 1 });
  });
});

describe('createAppSession shared tile queue', () => {
  const STUB_SESSION = {
    scene: { width: 768, height: 768 },
    video: {},
    tileBase: 'app://bundle/tiles',
    bbox: { minLat: 46.6, maxLat: 46.62, minLon: 14.2, maxLon: 14.22 },
    durationSec: 1,
  } as unknown as UiSession;

  const warmTilesOf = (request: WarmRequest) =>
    displayedTiles(
      STUB_SESSION.bbox,
      planView(STUB_SESSION.bbox, 768, 768, request.settings).zoom,
      request.frame,
      request.settings,
    );

  it('hands the preparation the very stream the warm uses', async () => {
    const file = mp4();
    const streamTiles = vi.fn(
      async (): Promise<PrefetchStats> => ({ downloaded: 0, failed: 0, total: 0 }),
    );
    let received: Partial<PipelineDeps> | undefined;
    const prepare = vi.fn<PrepareUiSession>(
      async (_file, _config, _log, _onProgress, _frame, deps) => {
        received = deps;
        return SESSION;
      },
    );
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => file,
      prepare,
      streamTiles,
    });

    await session.pick(REQUEST);

    expect(received?.prefetchTiles).toBe(streamTiles);
  });

  it('keeps every lane inside one 500 ms budget through the app composition', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response(new Uint8Array([1]), { status: 200 });
      }),
    );
    // The app composition (app/main.mjs): one tile traffic drives the warm
    // stream and, through the injected deps, the preparation's gate pre-warm.
    const traffic = createTileTraffic(dir);
    const gateTiles = [
      { z: 1, x: 0, y: 0 },
      { z: 1, x: 0, y: 1 },
      { z: 1, x: 0, y: 2 },
      { z: 1, x: 0, y: 3 },
    ];
    const prepare: PrepareUiSession = async (_file, _config, _log, _onProgress, _frame, deps) => {
      await deps?.prefetchTiles?.({ style: 'satellite', tiles: gateTiles, cacheDir: dir });
      return STUB_SESSION;
    };
    const session = createAppSession({
      config: { tileCache: dir } as RenderConfig,
      pickFile: async () => mp4(),
      prepare,
      streamTiles: (options) => traffic.stream(options),
    });

    // The gate pre-warm runs while the live player still fetches tiles.
    const picking = session.pick(REQUEST);
    const playerA = traffic.ensure('satellite', { z: 1, x: 9, y: 0 });
    const playerB = traffic.ensure('satellite', { z: 1, x: 9, y: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await picking).toEqual({ ok: true });

    // The hand-over onto the background warm, with the player still going.
    session.warm.retarget(REQUEST);
    const playerC = traffic.ensure('satellite', { z: 1, x: 9, y: 2 });
    await vi.advanceTimersByTimeAsync(60000);
    await Promise.all([playerA, playerB, playerC]);

    expect(starts).toHaveLength(gateTiles.length + 3 + warmTilesOf(REQUEST).length);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });

  it('warms into the session cache even when a lane names another directory', async () => {
    const dir = tmpDir();
    const other = tmpDir();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })),
    );
    const prepare: PrepareUiSession = async (_file, _config, _log, _onProgress, _frame, deps) => {
      await deps?.prefetchTiles?.({
        style: 'satellite',
        tiles: [{ z: 1, x: 0, y: 0 }],
        cacheDir: other,
      });
      return SESSION;
    };
    // No streamTiles: the session's own queue serves warm and preparation.
    const session = createAppSession({
      config: { tileCache: dir } as RenderConfig,
      pickFile: async () => mp4(),
      prepare,
    });

    expect(await session.pick(REQUEST)).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dir, 'esri-imagery', '1', '0', '0.png'))).toBe(true);
    expect(fs.existsSync(path.join(other, 'esri-imagery', '1', '0', '0.png'))).toBe(false);
  });
});

describe('prepareUiSession', () => {
  it('warms the gate tiles through the injected deps', async () => {
    const prefetchTiles = vi.fn(
      async ({ tiles }: PrefetchOptions): Promise<PrefetchStats> => ({
        downloaded: tiles.length,
        failed: 0,
        total: tiles.length,
      }),
    );
    const config = testConfig();

    const ui = await prepareUiSession(
      'clips/flight.mp4',
      config,
      () => {},
      undefined,
      { width: 480, height: 270 },
      stubDeps({ prefetchTiles }),
    );

    expect(prefetchTiles).toHaveBeenCalledTimes(1);
    const warm = prefetchTiles.mock.calls[0][0];
    expect(warm.style).toBe(config.style);
    expect(warm.cacheDir).toBe(config.tileCache);
    expect(warm.tiles.length).toBeGreaterThan(0);
    expect(ui.bbox).toEqual(telemetryFixture().bbox);
    expect(ui.video.frames).toBe(probeFixture().frames);
  });

  it('fails the preparation when the gate warm fails', async () => {
    const prefetchTiles = vi.fn(async (): Promise<PrefetchStats> => {
      throw new Error('cache unwritable');
    });

    await expect(
      prepareUiSession(
        'clips/flight.mp4',
        testConfig(),
        () => {},
        undefined,
        { width: 480, height: 270 },
        stubDeps({ prefetchTiles }),
      ),
    ).rejects.toThrow('cache unwritable');
  });
});
