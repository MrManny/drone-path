import { describe, expect, it, vi } from 'vitest';

import {
  createAppSession,
  frameExactDuration,
  parsePickRequest,
  parseTelemetrySaveRequest,
  prepareUiSession,
} from '../src/appsession.js';
import type {
  PickRequest,
  PreparedUiSession,
  PrepareUiSessionFn,
  UiSession,
} from '../src/appsession.js';
import type { RenderConfig } from '../src/config.js';
import { processRecording } from '../src/pipeline.js';
import type { PrepareProgress } from '../src/pipeline.js';
import { TelemetryDocumentSchema } from '../src/telemetry-json.js';
import type { TelemetryDocumentInput } from '../src/telemetry-json.js';
import type { PrefetchStats, WarmOptions } from '../src/tiles.js';
import {
  cleanupTmpDirs,
  loadedTelemetry,
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
const TELEMETRY = {
  source: 'srt',
  headingMode: 'cog',
  frameCount: 3,
  frames: [],
  headingDeg: [90, 91, 92],
} as unknown as TelemetryDocumentInput;
const PREPARED: PreparedUiSession = {
  session: SESSION,
  telemetry: TELEMETRY,
  track: { records: [], fpsValue: 30, frameCount: 3 },
};

const REQUEST: PickRequest = {
  settings: {
    style: 'satellite',
    view: 'overview',
    zoom: 0,
    zoomOut: 0,
    hud: { heading: true, alt: false, speed: false },
    introSec: 0,
    outroSec: 0,
    trailColor: null,
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
    const prepare = vi.fn(async (): Promise<PreparedUiSession> => PREPARED);
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
    const prepare = vi.fn(async (): Promise<PreparedUiSession> => PREPARED);
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
    let release = null as ((value: PreparedUiSession) => void) | null;
    const prepare = vi.fn(
      () =>
        new Promise<PreparedUiSession>((resolve) => {
          release = resolve;
        }),
    );
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare });

    const first = session.pick(REQUEST);
    const second = await session.pick(REQUEST);
    expect(second).toEqual({ ok: false, error: 'a pick is already in progress' });
    if (release) release(PREPARED);
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
    const prepare = vi.fn(async (): Promise<PreparedUiSession> => {
      order.push('prepare');
      return PREPARED;
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
    const prepare = vi.fn<PrepareUiSessionFn>(async (_file, _config, _log, onProgress) => {
      onProgress?.(reported);
      return PREPARED;
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
    trailColor: null,
  };

  it('takes the look settings off the renderer request', () => {
    expect(parsePickRequest({ settings })).toEqual({ settings });
  });

  it('takes the trail color along', () => {
    const withColor = { ...settings, trailColor: '#41f0ff' };
    expect(parsePickRequest({ settings: withColor })).toEqual({ settings: withColor });
  });

  it('rejects an unreadable trail color', () => {
    expect(() => parsePickRequest({ settings: { ...settings, trailColor: 'neon' } })).toThrow(
      'invalid value for trail color',
    );
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

    expect(prefetchTiles).not.toHaveBeenCalled();
    expect(events.map((e) => e.stage)).toEqual(['probe', 'telemetry', 'plan']);
    expect(ui.session.bbox).toEqual(telemetryFixture().bbox);
    expect(ui.session.video.frames).toBe(probeFixture().frames);
    expect(ui.session.video.src).toContain('video');
    expect(ui.telemetry.frameCount).toBe(probeFixture().frames);
    expect(ui.telemetry.headingDeg).toEqual([90, 91, 92]);
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

  it('gives every loaded recording its own media URL (#160)', async () => {
    const uiA = await prepareUiSession('clips/flight-a.mp4', testConfig(), () => {}, undefined, stubDeps());
    const uiB = await prepareUiSession('clips/flight-b.mp4', testConfig(), () => {}, undefined, stubDeps());

    expect(uiA.session.video.src).not.toBe(uiB.session.video.src);
    expect(new URL(uiA.session.video.src).pathname).toBe('/media/video');
    expect(new URL(uiB.session.video.src).pathname).toBe('/media/video');
  });
});

function saveDeps() {
  const telemetry = telemetryFixture({
    frames: [
      { fix: { lat: 46.6, lon: 14.2 }, alt: 3.3, speed: 1.2, headingDeg: 90 },
      { fix: { lat: 46.61, lon: 14.21 }, alt: 3.4, speed: 1.3, headingDeg: 91 },
      { fix: { lat: 46.62, lon: 14.22 }, alt: 3.5, speed: 1.4, headingDeg: 92 },
      { fix: { lat: 46.63, lon: 14.23 }, alt: 3.6, speed: 1.5, headingDeg: 93 },
      { fix: { lat: 46.64, lon: 14.24 }, alt: 3.7, speed: 1.6, headingDeg: 94 },
    ],
  });
  return stubDeps({
    probe: probeFixture({ frames: 5 }),
    telemetry,
    loaded: loadedTelemetry({
      telemetry,
      frameValues: [
        { lat: 46.6, lng: 14.2, altRel: 3.3, iso: 340 },
        { altRel: 3.4 },
        { lat: null, lng: null, altRel: 3.5 },
        {},
        { lat: 46.64, lng: 14.24, altRel: 3.7 },
      ],
      trackValues: [
        { lat: 46.6, lng: 14.2, altRel: 3.3, iso: 340, tSec: 0 },
        { altRel: 3.4, tSec: 1 / 30 },
        { lat: null, lng: null, altRel: 3.5, tSec: 2 / 30 },
        { tSec: 3 / 30 },
        { lat: 46.64, lng: 14.24, altRel: 3.7, tSec: 4 / 30 },
      ],
      protoFile: 'dvtm_NEO2.proto v02.00.07',
      gimbalDevice: { id: 0, type: 1, subType: 3, name: 'gimbal', frequency: 200 },
    }),
  });
}

async function loadedSession(file: string, deps = saveDeps()) {
  const session = createAppSession({
    config: testConfig(),
    pickFile: async () => file,
    prepare: (video, config, log, onProgress) =>
      prepareUiSession(video, config, log, onProgress, deps),
  });
  expect((await session.pick(REQUEST)).ok).toBe(true);
  return session;
}

describe('parseTelemetrySaveRequest', () => {
  it('takes the destination and the range off the renderer request', () => {
    expect(
      parseTelemetrySaveRequest({
        outPath: '/exports/flight.telemetry.json',
        range: { start: 1, end: 3 },
      }),
    ).toEqual({ outPath: '/exports/flight.telemetry.json', range: { start: 1, end: 3 } });
  });

  it('treats a missing or null range as the full recording', () => {
    const expected = { outPath: '/exports/flight.telemetry.json', range: null };
    expect(parseTelemetrySaveRequest({ outPath: '/exports/flight.telemetry.json' })).toEqual(
      expected,
    );
    expect(
      parseTelemetrySaveRequest({ outPath: '/exports/flight.telemetry.json', range: null }),
    ).toEqual(expected);
  });

  it('rejects junk payloads, unknown keys and empty paths', () => {
    expect(() => parseTelemetrySaveRequest(null)).toThrow('invalid telemetry save request');
    expect(() => parseTelemetrySaveRequest([])).toThrow('invalid telemetry save request');
    expect(() => parseTelemetrySaveRequest({})).toThrow('outPath');
    expect(() => parseTelemetrySaveRequest({ outPath: '' })).toThrow('outPath');
    expect(() => parseTelemetrySaveRequest({ outPath: 7 })).toThrow('outPath');
    expect(() =>
      parseTelemetrySaveRequest({ outPath: '/a.json', surprise: 1 }),
    ).toThrow('unknown telemetry save request key surprise');
  });

  it('rejects an unsupported destination extension, like the export request rejects non-.mp4', () => {
    expect(() => parseTelemetrySaveRequest({ outPath: '/exports/flight.txt' })).toThrow(
      'outPath must be a .gpx, .geojson, .kml, .kmz or .json file',
    );
    expect(() => parseTelemetrySaveRequest({ outPath: '/exports/flight' })).toThrow(
      'outPath must be a .gpx, .geojson, .kml, .kmz or .json file',
    );
  });

  it.for([
    'flight.gpx',
    'flight.geojson',
    'flight.kml',
    'flight.kmz',
    'flight.json',
    'flight.GPX',
    'flight.telemetry.json',
  ])('accepts the %s destination', (name) => {
    expect(parseTelemetrySaveRequest({ outPath: `/exports/${name}` }).outPath).toBe(
      `/exports/${name}`,
    );
  });

  it('rejects an invalid range through the shared frame-range rule', () => {
    expect(() =>
      parseTelemetrySaveRequest({ outPath: '/a.json', range: { start: 3, end: 2 } }),
    ).toThrow('0 <= start <= end');
    expect(() =>
      parseTelemetrySaveRequest({ outPath: '/a.json', range: { start: 0, end: 1, extra: 2 } }),
    ).toThrow('unknown frame range key extra');
  });
});

describe('AppSession.saveTelemetryJson', () => {
  it('writes the versioned document for the full recording', async () => {
    const session = await loadedSession(mp4());
    const out = path.join(tmpDir(), 'flight.telemetry.json');
    session.saveTelemetryJson(out, null);

    const doc = JSON.parse(fs.readFileSync(out, 'utf8')) as Record<string, unknown>;
    expect(doc.schemaVersion).toBe(1);
    expect(doc.frameCount).toBe(5);
    expect((doc.frames as { frame: number }[]).map((f) => f.frame)).toEqual([0, 1, 2, 3, 4]);
    expect(doc.protoFile).toBe('dvtm_NEO2.proto v02.00.07');
  });

  it('writes only the In-Out segment, keeping the source frame numbers', async () => {
    const session = await loadedSession(mp4());
    const out = path.join(tmpDir(), 'segment.telemetry.json');
    session.saveTelemetryJson(out, { start: 1, end: 3 });

    const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(doc.frameCount).toBe(3);
    expect(doc.frames.map((f: { frame: number }) => f.frame)).toEqual([1, 2, 3]);
    expect(doc.frames.map((f: { headingDeg: number }) => f.headingDeg)).toEqual([91, 92, 93]);
    expect(doc.frames[0]).toMatchObject({ frame: 1, altRel: 3.4, headingSource: 'cog' });
    expect(doc.frames[2]).toEqual({ frame: 3, headingDeg: 93, headingSource: 'cog' });
    expect(TelemetryDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('omits missing values as absent keys and never writes nulls', async () => {
    const session = await loadedSession(mp4());
    const out = path.join(tmpDir(), 'fields.telemetry.json');
    session.saveTelemetryJson(out, null);

    const raw = fs.readFileSync(out, 'utf8');
    expect(raw).not.toContain('null');
    const doc = JSON.parse(raw);
    expect(doc.frames[1]).toEqual({ frame: 1, altRel: 3.4, headingDeg: 91, headingSource: 'cog' });
    expect(doc.frames[2]).not.toHaveProperty('lat');
    expect(doc.frames[2]).not.toHaveProperty('lng');
    expect(doc.frames[0].iso).toBe(340);
    expect(doc.frames[1]).not.toHaveProperty('iso');
  });

  it('writes a single-frame segment for a lone In-Out point', async () => {
    const session = await loadedSession(mp4());
    const out = path.join(tmpDir(), 'single.telemetry.json');
    session.saveTelemetryJson(out, { start: 2, end: 2 });

    const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(doc.frameCount).toBe(1);
    expect(doc.frames.map((f: { frame: number }) => f.frame)).toEqual([2]);
    expect(TelemetryDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('honors the In-Out range for the track formats', async () => {
    const session = await loadedSession(mp4());
    const out = path.join(tmpDir(), 'segment.gpx');
    session.saveTelemetryJson(out, { start: 3, end: 4 });

    // rows 3-4 hold one fix (row 4), so the export is a single-vertex track
    const gpx = fs.readFileSync(out, 'utf8');
    expect(gpx.match(/<trkpt /g)).toHaveLength(1);
    expect(gpx).toContain('<trkpt lat="46.64" lon="14.24"/>');
    expect(gpx).not.toContain('46.6"');
  });

  it('selects sample-indexed track records (cammeta-scan) by time, not by position', async () => {
    // 3 scan records over a 5-frame clip: record count unrelated to frames
    const telemetry = telemetryFixture();
    const deps = stubDeps({
      probe: probeFixture({ frames: 5 }),
      telemetry,
      loaded: loadedTelemetry({
        telemetry,
        frameValues: [],
        trackValues: [
          { lat: 46.6, lng: 14.2, tSec: 0 }, // frame 0
          { lat: 46.62, lng: 14.22, tSec: 0.1 }, // frame 3
          { lat: 46.64, lng: 14.24, tSec: 0.133333 }, // frame 4
        ],
      }),
    });
    const session = await loadedSession(mp4(), deps);

    const out = path.join(tmpDir(), 'scan.gpx');
    session.saveTelemetryJson(out, { start: 0, end: 2 });
    const gpx = fs.readFileSync(out, 'utf8');
    // frames 0-2 hold only the frame-0 fix; a positional slice would have
    // written the first three records
    expect(gpx.match(/<trkpt /g)).toHaveLength(1);
    expect(gpx).toContain('46.6"');
    expect(gpx).not.toContain('46.62');

    const full = path.join(tmpDir(), 'scan-full.gpx');
    session.saveTelemetryJson(full, null);
    expect((fs.readFileSync(full, 'utf8').match(/<trkpt /g) ?? []).length).toBe(3);
  });

  it.for([
    { what: 'a negative start', range: { start: -1, end: 2 }, message: '0 <= start <= end' },
    { what: 'a reversed range', range: { start: 3, end: 1 }, message: '0 <= start <= end' },
    { what: 'fractional frames', range: { start: 0.5, end: 2 }, message: 'integer frame indices' },
    { what: 'an end past the recording', range: { start: 3, end: 5 }, message: 'beyond the recording' },
    {
      what: 'a far out-of-bounds range',
      range: { start: 0, end: 5000 },
      message: 'beyond the recording (5 frames)',
    },
  ])('rejects $what and writes nothing', async ({ range, message }) => {
    const session = await loadedSession(mp4());
    // every format validates the range - document and track formats alike
    for (const name of ['range.telemetry.json', 'range.gpx', 'range.kmz']) {
      const out = path.join(tmpDir(), name);
      expect(() => session.saveTelemetryJson(out, range)).toThrow(message);
      expect(fs.existsSync(out)).toBe(false);
    }
  });

  it('refuses to save when no recording is loaded', () => {
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => null,
      prepare: vi.fn(),
    });
    expect(() => session.saveTelemetryJson(path.join(tmpDir(), 'x.json'), null)).toThrow(
      'no recording loaded',
    );
  });
});

describe('saveTelemetryJson byte parity', () => {
  it.for(['json', 'gpx', 'geojson', 'kml', 'kmz'])(
    'writes the same .%s bytes as processRecording with trackOut',
    async (extension) => {
      const file = mp4('flight.mp4');
      const dir = tmpDir();
      const cliFile = path.join(dir, `cli.telemetry.${extension}`);
      const desktopFile = path.join(dir, `desktop.telemetry.${extension}`);
      const deps = saveDeps();

      await processRecording(
        file,
        testConfig({ trackOut: cliFile }),
        () => {},
        path.join(dir, 'out.mp4'),
        { deps },
      );
      const session = await loadedSession(file, deps);
      session.saveTelemetryJson(desktopFile, null);

      expect(fs.readFileSync(desktopFile)).toEqual(fs.readFileSync(cliFile));
    },
  );
});
