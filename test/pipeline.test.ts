import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../src/config.js';
import { planView } from '../src/plan.js';
import { serializeGpx } from '../src/track-gpx.js';
import { buildTrack } from '../src/track.js';
import {
  frameChannelsOf,
  outputPathFor,
  planOutputs,
  prepareSession,
  processRecording,
  recordingPageOpts,
  runBatch,
} from '../src/pipeline.js';
import type { PipelineDeps, PrepareProgress, RecordingSummary } from '../src/pipeline.js';
import type { FfmpegToolPaths } from '../src/ffmpeg-tools.js';
import { tilePaths } from '../src/tilecache.js';
import { START_PREPARE_PROGRESS } from '../ui/lib/pickstate.js';
import {
  cleanupTmpDirs,
  loadedTelemetry,
  probeFixture,
  stubDeps,
  telemetryFixture,
  testConfig,
  tmpDir,
} from './fixtures.js';

describe('planOutputs', () => {
  const config = { ...DEFAULT_CONFIG, outDir: path.join('out', 'maps') };

  it('keeps unique output names untouched', () => {
    const videos = [path.join('a', 'clip1.mp4'), path.join('b', 'clip2.mp4')];
    const plans = planOutputs(videos, config);
    expect(plans.map((p) => p.out)).toEqual([
      path.join('out', 'maps', 'clip1_map.mp4'),
      path.join('out', 'maps', 'clip2_map.mp4'),
    ]);
    expect(plans[0]).toEqual({
      out: outputPathFor(videos[0], config),
      plain: outputPathFor(videos[0], config),
    });
  });

  it('disambiguates same-basename recordings in a shared out dir', () => {
    const videos = [
      path.join('a', 'clip.mp4'),
      path.join('b', 'clip.mp4'),
      path.join('c', 'clip.mp4'),
    ];
    const plans = planOutputs(videos, config);
    expect(plans.map((p) => p.out)).toEqual([
      path.join('out', 'maps', 'clip_map.mp4'),
      path.join('out', 'maps', 'clip_map-2.mp4'),
      path.join('out', 'maps', 'clip_map-3.mp4'),
    ]);
    expect(new Set(plans.map((p) => p.out)).size).toBe(3);
    expect(plans.map((p) => p.plain)).toEqual(videos.map((v) => outputPathFor(v, config)));
  });

  it('applies the platform case rule to names differing only in case', () => {
    const videos = [path.join('a', 'CLIP.mp4'), path.join('b', 'clip.mp4')];
    const plans = planOutputs(videos, config);
    if (process.platform === 'win32') {
      expect(plans[0].out).toBe(plans[0].plain);
      expect(plans[1].out).not.toBe(plans[1].plain);
    } else {
      expect(plans[0].out).toBe(plans[0].plain);
      expect(plans[1].out).toBe(plans[1].plain);
    }
  });

  it('is deterministic across runs with the same input list', () => {
    const videos = [path.join('a', 'clip.mp4'), path.join('b', 'clip.mp4')];
    expect(planOutputs(videos, config)).toEqual(planOutputs(videos, config));
  });
});

describe('frameChannelsOf', () => {
  it('collects positions and per-frame values into parallel arrays', () => {
    const arrays = frameChannelsOf(telemetryFixture());
    expect(arrays.lat).toEqual([46.6, 46.61, 46.62]);
    expect(arrays.lon).toEqual([14.2, 14.21, 14.22]);
    expect(arrays.alt).toEqual([3.3, 3.4, 3.5]);
    expect(arrays.speed).toEqual([1.2, 1.3, 1.4]);
    expect(arrays.headingDeg).toEqual([90, 91, 92]);
  });

  it('fails fast naming the frame when a position is missing', () => {
    const tel = telemetryFixture({
      frames: [
        { fix: { lat: 46.6, lon: 14.2 }, alt: 3.3, speed: 1.2, headingDeg: 90 },
        { fix: null, alt: 3.4, speed: 1.3, headingDeg: 91 },
      ],
    });
    expect(() => frameChannelsOf(tel)).toThrow('telemetry frame 1 has no GPS position');
  });
});

const VIDEO = path.join('clips', 'flight.mp4');

const PROBE = probeFixture();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanupTmpDirs();
});

describe('prepareSession', () => {
  it('carries the effective canvas through and lets the planner decimate once', async () => {
    const config = testConfig({ width: 766, height: 500 });
    const prep = await prepareSession(VIDEO, config, () => {}, { deps: stubDeps() });
    expect(prep.width).toBe(766);
    expect(prep.height).toBe(500);
    expect(prep.frames.lat).toHaveLength(3);
    const opts = recordingPageOpts(prep, config);
    expect(opts.decimated.frame[0]).toBe(0);
    expect(opts.decimated.frame[opts.decimated.frame.length - 1]).toBe(2);
    expect(prep.hud).toEqual({ heading: true, alt: false, speed: false });
  });

  it('logs the intro/outro clamp note once when the clip forces clamping', async () => {
    const lines: string[] = [];
    const config = testConfig();
    const prep = await prepareSession(VIDEO, config, (msg) => lines.push(msg), {
      deps: stubDeps(),
    });
    recordingPageOpts(prep, config);
    expect(lines.filter((l) => l.startsWith('intro/outro shortened'))).toEqual([
      'intro/outro shortened to 1/1 frames for this clip',
    ]);
  });

  it('stays silent about intro and outro when the clip fits the plan', async () => {
    const lines: string[] = [];
    await prepareSession(VIDEO, testConfig(), (msg) => lines.push(msg), {
      deps: stubDeps({ probe: probeFixture({ frames: 3000 }) }),
    });
    expect(lines.some((l) => l.startsWith('intro/outro shortened'))).toBe(false);
  });
});

describe('prepareSession progress reports', () => {
  it('reports one step at the start of every stage', async () => {
    const events: PrepareProgress[] = [];
    await prepareSession(VIDEO, testConfig(), () => {}, {
      deps: stubDeps(),
      onProgress: (progress) => events.push(progress),
    });

    expect(events).toEqual([
      START_PREPARE_PROGRESS,
      { stage: 'telemetry', done: 1, total: 3 },
      { stage: 'plan', done: 2, total: 3 },
    ]);
  });

  it('stops reporting once a stage fails', async () => {
    const events: PrepareProgress[] = [];
    const deps = stubDeps({
      loadTelemetry: async () => {
        throw new Error('telemetry unreadable');
      },
    });
    await expect(
      prepareSession(VIDEO, testConfig(), () => {}, {
        deps,
        onProgress: (progress) => events.push(progress),
      }),
    ).rejects.toThrow('telemetry unreadable');
    expect(events.map((e) => e.stage)).toEqual(['probe', 'telemetry']);
  });
});

describe('processRecording tile pre-warm', () => {
  function warmRecorder() {
    const warmed: { z: number; x: number; y: number }[][] = [];
    const deps = stubDeps({
      prefetchTiles: async ({ tiles }) => {
        warmed.push(tiles);
        return { downloaded: tiles.length, failed: 0, total: tiles.length };
      },
    });
    return { deps, warmed };
  }

  it('warms the whole planned tile set before the render starts', async () => {
    const { deps, warmed } = warmRecorder();
    const config = testConfig();
    const out = path.join(tmpDir(), 'out.mp4');
    const summary = await processRecording(VIDEO, config, () => {}, out, { deps });

    expect(warmed).toHaveLength(1);
    expect(warmed[0]).toEqual(
      planView(telemetryFixture().bbox, config.width, config.height, config).tiles,
    );
    expect(summary.tilesDownloaded).toBe(warmed[0].length);
  });

  it('keeps waiting for the tiles before the first rendered frame', async () => {
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rendered: string[] = [];
    const deps = stubDeps({
      prefetchTiles: async ({ tiles }) => {
        rendered.push('prefetch:start');
        await waiting;
        rendered.push('prefetch:done');
        return { downloaded: tiles.length, failed: 0, total: tiles.length };
      },
      renderVideo: async () => {
        rendered.push('render');
        return { profile: { evalMs: 0, captureMs: 0, emitMs: 0 } };
      },
    });

    const pending = processRecording(VIDEO, testConfig(), () => {}, path.join(tmpDir(), 'out.mp4'), {
      deps,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rendered).toEqual(['prefetch:start']);
    release();
    await pending;
    expect(rendered).toEqual(['prefetch:start', 'prefetch:done', 'render']);
  });

  it('counts cached and failed tiles toward the summary', async () => {
    const deps = stubDeps({
      prefetchTiles: async ({ tiles }) => {
        return { downloaded: 1, failed: tiles.length - 1, total: tiles.length };
      },
    });
    const summary = await processRecording(
      VIDEO,
      testConfig(),
      () => {},
      path.join(tmpDir(), 'out.mp4'),
      { deps },
    );
    expect(summary.tilesDownloaded).toBe(1);
  });

  it('fails the render when the tile pre-warm fails', async () => {
    const deps = stubDeps({
      prefetchTiles: async () => {
        throw new Error('tile download exploded');
      },
    });
    await expect(
      processRecording(VIDEO, testConfig(), () => {}, path.join(tmpDir(), 'out.mp4'), { deps }),
    ).rejects.toThrow('tile download exploded');
  });
});

describe('processRecording deps overrides', () => {
  it('runs the real prefetch into the run cache when only other deps are overridden', async () => {
    vi.useFakeTimers();
    const stubs = stubDeps();
    const fetchStub = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const config = testConfig();

    const pending = processRecording(VIDEO, config, () => {}, path.join(tmpDir(), 'out.mp4'), {
      deps: {
        probeVideo: stubs.probeVideo,
        loadTelemetry: stubs.loadTelemetry,
        renderVideo: stubs.renderVideo,
        verifyOutput: stubs.verifyOutput,
      },
    });
    await vi.advanceTimersByTimeAsync(60000);
    const summary = await pending;

    expect(fetchStub).toHaveBeenCalledTimes(summary.tilesDownloaded ?? 0);
    expect(summary.tilesDownloaded).toBeGreaterThan(0);
    const first = planView(telemetryFixture().bbox, config.width, config.height, config).tiles[0];
    expect(fs.existsSync(tilePaths(config.tileCache, config.style, first).file)).toBe(true);
  });

  it.for([undefined, null])(
    'ignores a %s prefetch override and runs the real warm',
    async (nullish) => {
      vi.useFakeTimers();
      const stubs = stubDeps();
      const fetchStub = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
      vi.stubGlobal('fetch', fetchStub);

      const pending = processRecording(
        VIDEO,
        testConfig(),
        () => {},
        path.join(tmpDir(), 'out.mp4'),
        {
          deps: {
            probeVideo: stubs.probeVideo,
            loadTelemetry: stubs.loadTelemetry,
            renderVideo: stubs.renderVideo,
            verifyOutput: stubs.verifyOutput,
            prefetchTiles: nullish as unknown as PipelineDeps['prefetchTiles'],
          },
        },
      );
      await vi.advanceTimersByTimeAsync(60000);
      const summary = await pending;

      expect(summary.tilesDownloaded).toBeGreaterThan(0);
      expect(fetchStub).toHaveBeenCalledTimes(summary.tilesDownloaded ?? 0);
    },
  );
});

describe('processRecording failure handling', () => {
  it('propagates a probe failure and writes no output', async () => {
    const deps = stubDeps({
      probeVideo: async () => {
        throw new Error('ffprobe exploded');
      },
    });
    const out = path.join(tmpDir(), 'out.mp4');
    await expect(
      processRecording(VIDEO, testConfig(), () => {}, out, { deps }),
    ).rejects.toThrow('ffprobe exploded');
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('runBatch failure handling', () => {
  it('continues after a failure and still processes the remaining recordings', async () => {
    const deps = stubDeps({
      probeVideo: async (_tools, videoPath) => {
        if (videoPath.endsWith('broken.mp4')) throw new Error('no telemetry in file');
        return PROBE;
      },
    });
    const emitted: RecordingSummary[] = [];
    const result = await runBatch(
      [path.join('clips', 'broken.mp4'), path.join('clips', 'good.mp4')],
      testConfig(),
      () => {},
      (summary) => emitted.push(summary),
      { deps },
    );

    expect(result).toEqual({ ok: 1, skipped: 0, failed: 1 });
    expect(emitted.map((s) => s.status)).toEqual(['error', 'ok']);
    expect(emitted[0]?.error).toBe('no telemetry in file');
    expect(emitted[1]?.video).toBe(path.join('clips', 'good.mp4'));
  });
});

describe('processRecording encoder settings', () => {
  it('passes the encoder choices through to the render', async () => {
    let encode: { codec: string; quality: string; preset: string } | null = null;
    const deps = stubDeps({
      renderVideo: async (opts) => {
        encode = { codec: opts.codec, quality: opts.quality, preset: opts.preset };
        return { profile: { evalMs: 0, captureMs: 0, emitMs: 0 } };
      },
    });
    const out = path.join(tmpDir(), 'encoded.mp4');
    await processRecording(
      VIDEO,
      testConfig({ codec: 'h265', quality: 'low', preset: 'veryfast' }),
      () => {},
      out,
      { deps },
    );
    expect(encode).toEqual({ codec: 'h265', quality: 'low', preset: 'veryfast' });
  });
});

describe('tool threading', () => {
  it('passes the resolved tools to every tool-using dep', async () => {
    const tools: FfmpegToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };
    const seen: [string, FfmpegToolPaths][] = [];
    const deps = stubDeps({
      probeVideo: async (t) => {
        seen.push(['probeVideo', t]);
        return PROBE;
      },
      loadTelemetry: async (_video, spec) => {
        seen.push(['loadTelemetry', spec.tools]);
        return loadedTelemetry({ telemetry: telemetryFixture() });
      },
      renderVideo: async (opts) => {
        seen.push(['renderVideo', opts.tools]);
        return { profile: { evalMs: 0, captureMs: 0, emitMs: 0 } };
      },
      verifyOutput: async (t) => {
        seen.push(['verifyOutput', t]);
        return { frames: PROBE.frames, fps: PROBE.fps.str, ok: true };
      },
    });
    await processRecording(VIDEO, testConfig(), () => {}, path.join(tmpDir(), 'out.mp4'), {
      deps,
      tools,
    });
    expect(seen).toEqual([
      ['probeVideo', tools],
      ['loadTelemetry', tools],
      ['renderVideo', tools],
      ['verifyOutput', tools],
    ]);
  });

  it('passes the resolved tools to the skip check in runBatch', async () => {
    const tools: FfmpegToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };
    const seen: FfmpegToolPaths[] = [];
    const deps = stubDeps({
      outputMatchesSource: async (t) => {
        seen.push(t);
        return true;
      },
    });
    const result = await runBatch([VIDEO], testConfig({ skipExisting: true }), () => {}, () => {}, {
      deps,
      tools,
    });
    expect(result.skipped).toBe(1);
    expect(seen).toEqual([tools]);
  });
});

describe('processRecording frame ranges', () => {
  function rangeDeps() {
    const calls: { render?: { frames: number; frameStart?: number }; verify?: number } = {};
    const deps = stubDeps({
      probe: probeFixture({ frames: 40 }),
      renderVideo: async (opts) => {
        calls.render = { frames: opts.frames, frameStart: opts.frameStart };
        return { profile: { evalMs: 0, captureMs: 0, emitMs: 0 } };
      },
      verifyOutput: async (_tools, _outPath, expected) => {
        calls.verify = expected;
        return { frames: expected, fps: '30', ok: true };
      },
    });
    return { deps, calls };
  }

  it('renders only the segment, starting at the range start, and verifies its length', async () => {
    const { deps, calls } = rangeDeps();
    const out = path.join(tmpDir(), 'segment.mp4');
    const summary = await processRecording(VIDEO, testConfig(), () => {}, out, {
      deps,
      range: { start: 10, end: 29 },
    });
    expect(calls.render).toEqual({ frames: 20, frameStart: 10 });
    expect(calls.verify).toBe(20);
    expect(summary.frames).toBe(20);
    expect(summary.frameRange).toEqual({ start: 10, end: 29 });
  });

  it('renders the full recording from frame 0 when no range is given', async () => {
    const { deps, calls } = rangeDeps();
    const out = path.join(tmpDir(), 'full.mp4');
    const summary = await processRecording(VIDEO, testConfig(), () => {}, out, { deps });
    expect(calls.render).toEqual({ frames: 40, frameStart: 0 });
    expect(calls.verify).toBe(40);
    expect(summary.frames).toBe(40);
    expect(summary.frameRange).toBeUndefined();
  });

  it('exports a range that ends on the last frame', async () => {
    const { deps, calls } = rangeDeps();
    const out = path.join(tmpDir(), 'tail.mp4');
    await processRecording(VIDEO, testConfig(), () => {}, out, {
      deps,
      range: { start: 30, end: 39 },
    });
    expect(calls.render).toEqual({ frames: 10, frameStart: 30 });
  });

  it('renders a single-frame span for a lone In-Out point', async () => {
    const { deps, calls } = rangeDeps();
    const out = path.join(tmpDir(), 'single.mp4');
    const summary = await processRecording(VIDEO, testConfig(), () => {}, out, {
      deps,
      range: { start: 5, end: 5 },
    });
    expect(calls.render).toEqual({ frames: 1, frameStart: 5 });
    expect(calls.verify).toBe(1);
    expect(summary.frames).toBe(1);
    expect(summary.frameRange).toEqual({ start: 5, end: 5 });
  });

  it.each([
    ['start after end', { start: 9, end: 2 }, /0 <= start <= end/],
    ['end beyond the recording', { start: 0, end: 40 }, /beyond the recording \(40 frames\)/],
  ])('rejects %s before rendering anything', async (_label, range, pattern) => {
    const { deps, calls } = rangeDeps();
    await expect(
      processRecording(VIDEO, testConfig(), () => {}, path.join(tmpDir(), 'x.mp4'), {
        deps,
        range,
      }),
    ).rejects.toThrow(pattern);
    expect(calls.render).toBeUndefined();
  });

  it('refuses to start when the signal is already aborted', async () => {
    const { deps, calls } = rangeDeps();
    const controller = new AbortController();
    controller.abort();
    await expect(
      processRecording(VIDEO, testConfig(), () => {}, path.join(tmpDir(), 'x.mp4'), {
        deps,
        signal: controller.signal,
      }),
    ).rejects.toThrow('render canceled');
    expect(calls.render).toBeUndefined();
  });
});

describe('recording summary mapping', () => {
  it('maps the telemetry summary fields explicitly into the flat --json shape', async () => {
    const summary = await processRecording(VIDEO, testConfig(), () => {}, undefined, {
      deps: stubDeps(),
    });

    expect(summary).toMatchObject({
      source: 'srt',
      method: 'srt-cues',
      headingMode: 'cog',
      fixes: 3,
      noLock: 2,
      trackDistanceM: 42,
    });

    const jsonKeys = Object.keys(
      JSON.parse(JSON.stringify(summary)) as Record<string, unknown>,
    ).sort();
    expect(jsonKeys).toEqual(
      [
        'bbox',
        'elapsedSec',
        'fixes',
        'fps',
        'frames',
        'headingMode',
        'height',
        'hud',
        'introFrames',
        'method',
        'noLock',
        'out',
        'outroFrames',
        'source',
        'status',
        'style',
        'tilesDownloaded',
        'trackDistanceM',
        'verified',
        'video',
        'view',
        'width',
        'zoom',
        'zoomFixed',
        'zoomOut',
      ].sort(),
    );
  });
});

describe('--track-out export', () => {
  function exportDeps() {
    return stubDeps({
      loaded: loadedTelemetry({
        telemetry: telemetryFixture(),
        frameValues: [
          { lat: 46.6, lng: 14.2, altRel: 3.3 },
          { altRel: 3.4 },
          { lat: 46.62, lng: 14.22, altRel: 3.5 },
        ],
        trackValues: [
          { lat: 46.6, lng: 14.2, altRel: 3.3 },
          { altRel: 3.4 },
          { lat: 46.62, lng: 14.22, altRel: 3.5 },
        ],
        protoFile: 'dvtm_NEO2.proto v02.00.07',
        gimbalDevice: { id: 0, type: 1, subType: 3, name: 'gimbal', frequency: 200 },
      }),
    });
  }

  it('writes one document per recording to the given file', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'telemetry.json');
    await processRecording(
      VIDEO,
      testConfig({ trackOut: file }),
      () => {},
      path.join(dir, 'out.mp4'),
      { deps: exportDeps() },
    );

    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({
      schemaVersion: 1,
      protoFile: 'dvtm_NEO2.proto v02.00.07',
      source: 'srt',
      headingMode: 'cog',
      frameCount: 3,
      gimbalDevice: { id: 0, type: 1, subType: 3, name: 'gimbal', frequency: 200 },
      frames: [
        {
          frame: 0,
          lat: 46.6,
          lng: 14.2,
          altRel: 3.3,
          headingDeg: 90,
          headingSource: 'cog',
        },
        { frame: 1, altRel: 3.4, headingDeg: 91, headingSource: 'cog' },
        {
          frame: 2,
          lat: 46.62,
          lng: 14.22,
          altRel: 3.5,
          headingDeg: 92,
          headingSource: 'cog',
        },
      ],
    });
  });

  it('writes byte-identical documents on rerun', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'telemetry.json');
    const config = testConfig({ trackOut: file });
    await processRecording(VIDEO, config, () => {}, path.join(dir, 'out.mp4'), {
      deps: exportDeps(),
    });
    const first = fs.readFileSync(file);
    await processRecording(VIDEO, config, () => {}, path.join(dir, 'out.mp4'), {
      deps: exportDeps(),
    });
    expect(fs.readFileSync(file)).toEqual(first);
  });

  it('covers the whole recording even when the render is limited to a frame range', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'telemetry.json');
    await processRecording(
      VIDEO,
      testConfig({ trackOut: file }),
      () => {},
      path.join(dir, 'out.mp4'),
      { deps: exportDeps(), range: { start: 0, end: 1 } },
    );

    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      frameCount: number;
      frames: unknown[];
    };
    expect(doc.frameCount).toBe(3);
    expect(doc.frames).toHaveLength(3);
  });

  it('writes a GPX track whose segments break at telemetry gaps', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'track.gpx');
    await processRecording(
      VIDEO,
      testConfig({ trackOut: file }),
      () => {},
      path.join(dir, 'out.mp4'),
      { deps: exportDeps() },
    );

    const gpx = fs.readFileSync(file, 'utf8');
    expect(gpx).toBe(
      serializeGpx(buildTrack([
        { lat: 46.6, lng: 14.2, altRel: 3.3 },
        { altRel: 3.4 },
        { lat: 46.62, lng: 14.22, altRel: 3.5 },
      ])),
    );
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
  });

  it('writes no document for a recording the run skips', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'telemetry.json');
    const deps = stubDeps({ outputMatchesSource: async () => true });
    const result = await runBatch(
      [VIDEO],
      testConfig({ trackOut: file, skipExisting: true }),
      () => {},
      () => {},
      { deps },
    );
    expect(result.skipped).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('rejects a multi-recording run instead of overwriting the document', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'telemetry.json');
    await expect(
      runBatch(
        [VIDEO, path.join('clips', 'other.mp4')],
        testConfig({ trackOut: file }),
        () => {},
        () => {},
        { deps: stubDeps() },
      ),
    ).rejects.toThrow('--track-out writes one file per run');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('rejects a multi-recording run for every track format', async () => {
    const dir = tmpDir();
    await expect(
      runBatch(
        [VIDEO, path.join('clips', 'other.mp4')],
        testConfig({ trackOut: path.join(dir, 'track.kmz') }),
        () => {},
        () => {},
        { deps: stubDeps() },
      ),
    ).rejects.toThrow('--track-out writes one file per run');
  });
});
