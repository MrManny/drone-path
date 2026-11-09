import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';

import { DEFAULT_CONFIG } from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import { planView } from '../src/plan.js';
import {
  frameArrays,
  outputPathFor,
  planOutputs,
  prepareSession,
  processRecording,
  recordingPageOpts,
  runBatch,
} from '../src/run.js';
import type { PipelineDeps, PrepareProgress, RecordingSummary } from '../src/run.js';
import type { FfToolPaths } from '../src/fftools.js';
import { tilePaths } from '../src/tilecache.js';
import { loadTelemetry } from '../src/telemetry.js';
import { START_PREPARE_PROGRESS } from '../ui/lib/pickstate.js';
import {
  SRT_SAMPLE_MIXED,
  byName,
  cleanupTmpDirs,
  durationMs,
  loadedTelemetry,
  probeFixture,
  stubDeps,
  telemetryFixture,
  testConfig,
  tmpDir,
  tracingHarness,
  writeSrt,
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
    // renamed plans remember the plain path they deviate from
    expect(plans.map((p) => p.plain)).toEqual(videos.map((v) => outputPathFor(v, config)));
  });

  it('applies the platform case rule to names differing only in case', () => {
    const videos = [path.join('a', 'CLIP.mp4'), path.join('b', 'clip.mp4')];
    const plans = planOutputs(videos, config);
    if (process.platform === 'win32') {
      // Windows file names are case-insensitive: the outputs collide.
      expect(plans[0].out).toBe(plans[0].plain);
      expect(plans[1].out).not.toBe(plans[1].plain);
    } else {
      // POSIX file names are case-sensitive: both keep their plain names.
      expect(plans[0].out).toBe(plans[0].plain);
      expect(plans[1].out).toBe(plans[1].plain);
    }
  });

  it('is deterministic across runs with the same input list', () => {
    const videos = [path.join('a', 'clip.mp4'), path.join('b', 'clip.mp4')];
    expect(planOutputs(videos, config)).toEqual(planOutputs(videos, config));
  });
});

describe('frameArrays', () => {
  it('collects positions and per-frame values into parallel arrays', () => {
    const arrays = frameArrays(telemetryFixture());
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
    expect(() => frameArrays(tel)).toThrow('telemetry frame 1 has no GPS position');
  });
});

const VIDEO = path.join('clips', 'flight.mp4');

const PROBE = probeFixture();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
    // The page mapping reuses the prepared planning, so the note stays single.
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

    // The render path waits for the plan the view stage computed, not a gate.
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
    // The seam names no cache; the default warm binds the run's own cache.
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
            // The cast mirrors untyped shell code, which can legally send null.
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

describe('processRecording span tree', () => {
  async function tracedRun(
    deps: PipelineDeps,
    config: RenderConfig = testConfig(),
    video: string = VIDEO,
  ) {
    const harness = await tracingHarness();
    const summary = await processRecording(video, config, () => {}, undefined, {
      deps,
      trace: { tracer: harness.tracer },
    });
    const spans = await harness.finish();
    return { spans, summary };
  }

  it('emits one trace with the stage spans nested under the root', async () => {
    const { spans, summary } = await tracedRun(stubDeps());
    expect(spans.map((s) => s.name).sort()).toEqual([
      'output.verify',
      'plan',
      'probe',
      'recording.process',
      'telemetry.load',
      'tiles.prefetch',
    ]);

    const root = spans.find((s) => s.name === 'recording.process');
    expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
    for (const span of spans) {
      if (span === root) continue;
      expect(span.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
      expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
    }
    expect(summary.status).toBe('ok');
    expect(root?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it('carries the recording attributes on the root span', async () => {
    const { spans } = await tracedRun(stubDeps());
    const root = spans.find((s) => s.name === 'recording.process');
    expect(root?.attributes).toMatchObject({
      'source.file.name': 'flight.mp4',
      'source.frames': 3,
      'source.fps': 30,
      'canvas.width': 768,
      'canvas.height': 768,
      'map.style': 'satellite',
      'map.view': 'follow',
      'telemetry.source': 'srt',
    });
  });

  it('carries the stage attributes on each stage span', async () => {
    const { spans } = await tracedRun(stubDeps());

    expect(byName(spans, 'telemetry.load')?.attributes).toMatchObject({
      'telemetry.source': 'srt',
      'telemetry.method': 'srt-cues',
      'telemetry.fix.count': 3,
      'telemetry.noLock.count': 2,
    });
    expect(byName(spans, 'plan')?.attributes).toMatchObject({
      'plan.view': 'follow',
      'plan.zoomOut': 1,
      'plan.tile.count': expect.any(Number),
      'plan.zoom': expect.any(Number),
    });
    expect(byName(spans, 'tiles.prefetch')?.attributes).toMatchObject({
      'tiles.total': 5,
      'tiles.downloaded': 2,
      'tiles.cached': 2,
      'tiles.failed': 1,
    });
    expect(byName(spans, 'output.verify')?.attributes).toMatchObject({
      'verify.frames.expected': 3,
      'verify.frames.actual': 3,
      'verify.fps.expected': '30',
      'verify.fps.actual': '30',
      'verify.ok': true,
    });
  });

  it('measures real stage timings consistent with elapsedSec', async () => {
    const deps = stubDeps({
      probeVideo: async () => {
        await sleep(120);
        return PROBE;
      },
      renderVideo: async () => {
        await sleep(600);
        return { profile: { evalMs: 10, captureMs: 20, emitMs: 30 } };
      },
    });
    const { spans, summary } = await tracedRun(deps);
    const probe = byName(spans, 'probe');
    const root = byName(spans, 'recording.process');

    expect(durationMs(probe)).toBeGreaterThanOrEqual(110);
    expect(durationMs(root)).toBeGreaterThanOrEqual(700);
    expect(Math.abs(durationMs(root) - summary.elapsedSec * 1000)).toBeLessThanOrEqual(1000);
  });

  it('marks the failing span and the root ERROR and records the exception', async () => {
    const harness = await tracingHarness();
    const deps = stubDeps({
      probeVideo: async () => {
        throw new Error('ffprobe exploded');
      },
    });
    await expect(
      processRecording(VIDEO, testConfig(), () => {}, undefined, {
        deps,
        trace: { tracer: harness.tracer },
      }),
    ).rejects.toThrow('ffprobe exploded');
    const spans = await harness.finish();
    expect(spans.map((s) => s.name).sort()).toEqual([
      'probe',
      'recording.process',
    ]);
    for (const span of spans) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.some((e) => e.name === 'exception')).toBe(true);
    }
  });

  it('leaks no coordinates into span attributes', async () => {
    const { spans } = await tracedRun(stubDeps());
    const coordinateValues = [46.6, 46.61, 46.62, 14.2, 14.21, 14.22];
    for (const span of spans) {
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(key.toLowerCase()).not.toMatch(/lat|lon|bbox|coord/);
        expect(coordinateValues).not.toContain(value);
        expect(String(value)).not.toMatch(/-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+/);
      }
    }
  });

  it('reports the exact fix count of the telemetry source', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    writeSrt(video, SRT_SAMPLE_MIXED);
    const { spans } = await tracedRun(stubDeps({ loadTelemetry }), undefined, video);
    expect(byName(spans, 'telemetry.load')?.attributes).toMatchObject({
      'telemetry.fix.count': 2,
      'telemetry.noLock.count': 1,
    });
  });
});

describe('runBatch tracing', () => {
  it('continues after a failure and still exports the remaining recordings', async () => {
    const harness = await tracingHarness();
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
      { deps, trace: { tracer: harness.tracer } },
    );
    const spans = await harness.finish();

    expect(result).toEqual({ ok: 1, skipped: 0, failed: 1 });
    expect(emitted.map((s) => s.status)).toEqual(['error', 'ok']);

    const roots = spans.filter((s) => s.name === 'recording.process');
    expect(roots).toHaveLength(2);
    const bad = roots.find((s) => s.attributes['source.file.name'] === 'broken.mp4');
    const good = roots.find((s) => s.attributes['source.file.name'] === 'good.mp4');
    expect(bad?.status.code).toBe(SpanStatusCode.ERROR);
    expect(bad?.events.some((e) => e.name === 'exception')).toBe(true);
    expect(good?.status.code).not.toBe(SpanStatusCode.ERROR);

    const goodSpans = spans.filter(
      (s) => s.spanContext().traceId === good?.spanContext().traceId,
    );
    expect(goodSpans.map((s) => s.name).sort()).toEqual([
      'output.verify',
      'plan',
      'probe',
      'recording.process',
      'telemetry.load',
      'tiles.prefetch',
    ]);
  });

  it('emits no trace for skipped recordings', async () => {
    const harness = await tracingHarness();
    const deps = stubDeps({ outputMatchesSource: async () => true });
    const result = await runBatch(
      [VIDEO],
      testConfig({ skipExisting: true }),
      () => {},
      () => {},
      { deps, trace: { tracer: harness.tracer } },
    );
    const spans = await harness.finish();

    expect(result).toEqual({ ok: 0, skipped: 1, failed: 0 });
    expect(spans).toHaveLength(0);
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
    const tools: FfToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };
    const seen: [string, FfToolPaths][] = [];
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
    const tools: FfToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };
    const seen: FfToolPaths[] = [];
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

  it.each([
    ['start equal to end', { start: 5, end: 5 }, /0 <= start < end/],
    ['start after end', { start: 9, end: 2 }, /0 <= start < end/],
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

    // The NDJSON line stays flat: exactly the declared fields, nothing more.
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

describe('telemetry JSON export', () => {
  function exportDeps() {
    return stubDeps({
      loaded: loadedTelemetry({
        telemetry: telemetryFixture(),
        frameValues: [
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
      testConfig({ telemetryJson: file }),
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
    const config = testConfig({ telemetryJson: file });
    await processRecording(VIDEO, config, () => {}, path.join(dir, 'out.mp4'), {
      deps: exportDeps(),
    });
    const first = fs.readFileSync(file);
    await processRecording(VIDEO, config, () => {}, path.join(dir, 'out.mp4'), {
      deps: exportDeps(),
    });
    expect(fs.readFileSync(file)).toEqual(first);
  });

  it('writes no document for a recording the run skips', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'telemetry.json');
    const deps = stubDeps({ outputMatchesSource: async () => true });
    const result = await runBatch(
      [VIDEO],
      testConfig({ telemetryJson: file, skipExisting: true }),
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
        testConfig({ telemetryJson: file }),
        () => {},
        () => {},
        { deps: stubDeps() },
      ),
    ).rejects.toThrow('--telemetry-json writes one document per run');
    expect(fs.existsSync(file)).toBe(false);
  });
});
