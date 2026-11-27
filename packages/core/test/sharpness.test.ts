import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTmpDirs, probeFixture, tmpDir } from '../../../test/fixtures/core.js';
import * as execTool from '../src/exec-tool.js';
import * as ffmpeg from '../src/ffmpeg.js';
import type { FfmpegToolPaths } from '../src/ffmpeg-tools.js';
import {
  DEFAULT_MIN_EDGE_COVERAGE,
  SHARPNESS_ANALYSIS_WIDTH,
  SHARPNESS_ANALYZER_METHOD,
  SHARPNESS_ANALYZER_VERSION,
  analyzeClipSharpness,
  analyzeFrameSharpness,
  buildSharpnessFilterGraph,
  parseBlurdetectMetadata,
  scoreSharpnessSample,
} from '../src/sharpness.js';

vi.mock('../src/exec-tool.js', { spy: true });
vi.mock('../src/ffmpeg.js', { spy: true });

const tools: FfmpegToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanupTmpDirs();
});

describe('buildSharpnessFilterGraph', () => {
  it('builds the default fixed-width luminance filterchain without select', () => {
    expect(buildSharpnessFilterGraph()).toBe(
      `scale=${SHARPNESS_ANALYSIS_WIDTH}:-2:flags=area,format=gray,` +
        'blurdetect=high=0.117647:low=0.0588235:radius=50:planes=1,' +
        'edgedetect=low=0.0588235:high=0.117647:mode=wires,signalstats,metadata=mode=print:file=-',
    );
  });

  it('supports custom analysisWidth and stride', () => {
    const graph = buildSharpnessFilterGraph({ analysisWidth: 480, stride: 5 });
    expect(graph.startsWith("select='not(mod(n,5))',scale=480:-2:flags=area,")).toBe(true);
    expect(buildSharpnessFilterGraph({ stride: 1 })).toBe(buildSharpnessFilterGraph());
  });

  it.for([
    { analysisWidth: 0 },
    { analysisWidth: -10 },
    { analysisWidth: 320.5 },
    { stride: 0 },
    { stride: -2 },
    { stride: 1.5 },
  ])('rejects invalid options %j with a lowercase Error', (opts) => {
    expect(() => buildSharpnessFilterGraph(opts)).toThrow();
    try {
      buildSharpnessFilterGraph(opts);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/^[a-z]/u);
    }
  });
});

describe('parseBlurdetectMetadata', () => {
  it('parses single and multiple frame blocks including nan blur and clamps coverage', () => {
    const output = [
      'frame:0    pts:0       pts_time:0',
      'lavfi.blur=4.828293',
      'lavfi.signalstats.YMIN=0',
      'lavfi.signalstats.YAVG=10.2',
      'frame:1    pts:1001    pts_time:0.033367',
      'lavfi.blur=nan',
      'lavfi.signalstats.YAVG=0',
      'frame:2    pts:2002    pts_time:N/A',
      'lavfi.blur=2.5',
      'lavfi.signalstats.YAVG=300',
    ].join('\n');

    expect(parseBlurdetectMetadata(output)).toEqual([
      {
        index: 0,
        ptsTime: 0,
        blurWidth: 4.828293,
        edgeCoverage: 10.2 / 255,
      },
      {
        index: 1,
        ptsTime: 0.033367,
        blurWidth: null,
        edgeCoverage: 0,
      },
      {
        index: 2,
        ptsTime: null,
        blurWidth: 2.5,
        edgeCoverage: 1,
      },
    ]);
  });

  it('returns an empty array when output has no frame metadata', () => {
    expect(parseBlurdetectMetadata('')).toEqual([]);
    expect(parseBlurdetectMetadata('lavfi.blur=4.0\n')).toEqual([]);
  });
});

describe('scoreSharpnessSample', () => {
  it('scores sharper frames (smaller blur width) higher monotonically', () => {
    const sharp = scoreSharpnessSample(2, 0.05);
    const medium = scoreSharpnessSample(4, 0.05);
    const blurry = scoreSharpnessSample(12, 0.05);

    expect(sharp).toEqual({
      sharpnessScore: 66.67,
      edgeCoverage: 0.05,
      analyzer: {
        method: SHARPNESS_ANALYZER_METHOD,
        version: SHARPNESS_ANALYZER_VERSION,
      },
    });
    expect(medium.sharpnessScore).toBe(50);
    expect(blurry.sharpnessScore).toBe(25);
    expect(sharp.sharpnessScore!).toBeGreaterThan(medium.sharpnessScore!);
    expect(medium.sharpnessScore!).toBeGreaterThan(blurry.sharpnessScore!);
  });

  it.for([
    [null, 0.05],
    [0, 0.05],
    [-1, 0.05],
    [Number.NaN, 0.05],
    [Number.POSITIVE_INFINITY, 0.05],
    [2.5, DEFAULT_MIN_EDGE_COVERAGE - 0.0005],
    [2.5, 0],
  ] as const)('returns null score for blurWidth=%s edgeCoverage=%s', ([blurWidth, coverage]) => {
    const scored = scoreSharpnessSample(blurWidth, coverage);
    expect(scored.sharpnessScore).toBeNull();
    expect(scored.edgeCoverage).toBe(Math.max(0, Number(coverage.toFixed(6))));
    expect(scored.analyzer).toEqual({
      method: SHARPNESS_ANALYZER_METHOD,
      version: SHARPNESS_ANALYZER_VERSION,
    });
  });
});

describe('analyzeFrameSharpness', () => {
  it('invokes ffmpeg before JPEG encoding and parses stdout metadata', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    const runSpy = vi.mocked(execTool.runTool).mockResolvedValue({
      stdout: [
        'frame:0    pts:90000   pts_time:1.5',
        'lavfi.blur=4',
        'lavfi.signalstats.YAVG=25.5',
      ].join('\n'),
      stderr: '',
    });

    const result = await analyzeFrameSharpness(tools, videoPath, 1.5);

    expect(result).toEqual({
      sharpnessScore: 50,
      edgeCoverage: 0.1,
      analyzer: {
        method: SHARPNESS_ANALYZER_METHOD,
        version: SHARPNESS_ANALYZER_VERSION,
      },
    });
    expect(runSpy).toHaveBeenCalledWith(
      tools.ffmpeg,
      [
        '-v', 'error',
        '-ss', '1.500000',
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', buildSharpnessFilterGraph(),
        '-f', 'null',
        '-',
      ],
      { signal: undefined },
    );
  });

  it('falls back to stderr when stdout contains no frame metadata', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    vi.mocked(execTool.runTool).mockResolvedValue({
      stdout: '',
      stderr: [
        'frame:0    pts:0       pts_time:0',
        'lavfi.blur=nan',
        'lavfi.signalstats.YAVG=0',
      ].join('\n'),
    });

    const result = await analyzeFrameSharpness(tools, videoPath, 0);
    expect(result.sharpnessScore).toBeNull();
    expect(result.edgeCoverage).toBe(0);
  });

  it('wraps ffmpeg failures with cause and rejects empty metadata', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    const rootCause = new Error('spawn failed');
    vi.mocked(execTool.runTool).mockRejectedValueOnce(rootCause);

    const err = await analyzeFrameSharpness(tools, videoPath, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^ffmpeg failed/u);
    expect((err as Error).cause).toBe(rootCause);

    vi.mocked(execTool.runTool).mockResolvedValueOnce({ stdout: '', stderr: '' });
    await expect(analyzeFrameSharpness(tools, videoPath, 2)).rejects.toThrow(
      /no frame metadata/u,
    );
  });

  it('propagates abort errors without wrapping', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    const controller = new AbortController();
    const abortErr = new Error('canceled');
    controller.abort(abortErr);
    vi.mocked(execTool.runTool).mockRejectedValueOnce(abortErr);

    await expect(
      analyzeFrameSharpness(tools, videoPath, 1, { signal: controller.signal }),
    ).rejects.toBe(abortErr);
  });
});

function fakeSpawnedChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe('analyzeClipSharpness', () => {
  it('streams sampled 1/sec frames across chunk boundaries using stride from fps', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    const child = fakeSpawnedChild();
    const spawnSpy = vi
      .mocked(execTool.spawnTool)
      .mockReturnValue(child as unknown as ChildProcess);
    const probeSpy = vi.mocked(ffmpeg.probeVideo);

    const streamed: number[] = [];
    const promise = analyzeClipSharpness(tools, videoPath, {
      fps: 30000 / 1001,
      onSample: (s) => streamed.push(s.frameIndex),
    });

    child.stdout.write('frame:0    pts:0       pts_ti');
    child.stdout.write('me:0\nlavfi.blur=4\nlavfi.signalstats.YAVG=25.5\n');
    child.stdout.write('frame:1    pts:30030   pts_time:1.001\nlavfi.blur=nan\nlavfi.signalstats.YAVG=0\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('close', 0);

    const result = await promise;
    expect(probeSpy).not.toHaveBeenCalled();
    expect(spawnSpy).toHaveBeenCalledWith(
      tools.ffmpeg,
      [
        '-v', 'error',
        '-i', videoPath,
        '-vf', buildSharpnessFilterGraph({ stride: 30 }),
        '-f', 'null',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    expect(streamed).toEqual([0, 30]);
    expect(result).toEqual({
      analyzer: {
        method: SHARPNESS_ANALYZER_METHOD,
        version: SHARPNESS_ANALYZER_VERSION,
      },
      mode: 'sampled',
      stride: 30,
      analysisWidth: SHARPNESS_ANALYSIS_WIDTH,
      minEdgeCoverage: DEFAULT_MIN_EDGE_COVERAGE,
      samples: [
        { frameIndex: 0, tSec: 0, sharpnessScore: 50, edgeCoverage: 0.1 },
        { frameIndex: 30, tSec: 1.001, sharpnessScore: null, edgeCoverage: 0 },
      ],
    });
  });

  it('probes fps when sampled mode omits fps and supports every-frame mode without select', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    const probeSpy = vi
      .mocked(ffmpeg.probeVideo)
      .mockResolvedValue(probeFixture({ fps: { num: 60, den: 1, value: 60, str: '60' } }));

    const sampledChild = fakeSpawnedChild();
    const everyChild = fakeSpawnedChild();
    vi.mocked(execTool.spawnTool)
      .mockReturnValueOnce(sampledChild as unknown as ChildProcess)
      .mockReturnValueOnce(everyChild as unknown as ChildProcess);

    const sampledPromise = analyzeClipSharpness(tools, videoPath);
    await vi.waitFor(() => expect(execTool.spawnTool).toHaveBeenCalledTimes(1));
    sampledChild.stdout.end('frame:0 pts:0 pts_time:0\nlavfi.blur=4\nlavfi.signalstats.YAVG=25.5\n');
    sampledChild.stderr.end();
    sampledChild.emit('close', 0);

    const sampled = await sampledPromise;
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(sampled.stride).toBe(60);

    const everyPromise = analyzeClipSharpness(tools, videoPath, { mode: 'every-frame' });
    everyChild.stdout.end(
      'frame:0 pts:0 pts_time:0\nlavfi.blur=2\nlavfi.signalstats.YAVG=25.5\n' +
        'frame:1 pts:1 pts_time:0.016667\nlavfi.blur=4\nlavfi.signalstats.YAVG=25.5\n',
    );
    everyChild.stderr.end();
    everyChild.emit('close', 0);

    const every = await everyPromise;
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(every.mode).toBe('every-frame');
    expect(every.stride).toBe(1);
    expect(every.samples.map((s) => s.frameIndex)).toEqual([0, 1]);
    expect(vi.mocked(execTool.spawnTool).mock.calls[1][1]).toEqual([
      '-v', 'error',
      '-i', videoPath,
      '-vf', buildSharpnessFilterGraph({ stride: 1 }),
      '-f', 'null',
      '-',
    ]);
  });

  it('kills ffmpeg cleanly on AbortSignal and waits for child exit before settling', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    const child = fakeSpawnedChild();
    vi.mocked(execTool.spawnTool).mockReturnValue(child as unknown as ChildProcess);
    const controller = new AbortController();
    const abortErr = new Error('analysis canceled');

    let settled = false;
    const promise = analyzeClipSharpness(tools, videoPath, {
      fps: 30,
      signal: controller.signal,
    }).finally(() => {
      settled = true;
    });
    controller.abort(abortErr);

    expect(child.kill).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(settled).toBe(false);

    child.emit('close', null);
    await expect(promise).rejects.toBe(abortErr);
  });

  it('wraps spawn errors, rejects non-zero exits, and rejects empty metadata', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    const errChild = fakeSpawnedChild();
    const exitChild = fakeSpawnedChild();
    const emptyChild = fakeSpawnedChild();
    vi.mocked(execTool.spawnTool)
      .mockReturnValueOnce(errChild as unknown as ChildProcess)
      .mockReturnValueOnce(exitChild as unknown as ChildProcess)
      .mockReturnValueOnce(emptyChild as unknown as ChildProcess);

    const rootCause = new Error('spawn ENOENT');
    const errPromise = analyzeClipSharpness(tools, videoPath, { fps: 30 }).catch((e: unknown) => e);
    errChild.emit('error', rootCause);
    const wrapped = (await errPromise) as Error;
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toMatch(/^ffmpeg failed while analyzing clip sharpness/u);
    expect(wrapped.cause).toBe(rootCause);

    const exitPromise = analyzeClipSharpness(tools, videoPath, { fps: 30 });
    exitChild.stdout.end();
    exitChild.stderr.end('invalid stream');
    exitChild.emit('close', 1);
    await expect(exitPromise).rejects.toThrow(/\(exit code 1\): invalid stream/u);

    const emptyPromise = analyzeClipSharpness(tools, videoPath, { fps: 30 });
    emptyChild.stdout.end();
    emptyChild.stderr.end();
    emptyChild.emit('close', 0);
    await expect(emptyPromise).rejects.toThrow(/no frame metadata/u);
  });

  it('kills ffmpeg and rejects cleanly after exit when onSample throws during streaming or flush', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    const streamChild = fakeSpawnedChild();
    const flushChild = fakeSpawnedChild();
    vi.mocked(execTool.spawnTool)
      .mockReturnValueOnce(streamChild as unknown as ChildProcess)
      .mockReturnValueOnce(flushChild as unknown as ChildProcess);

    const streamErr = new Error('consumer failed mid-stream');
    let streamSettled = false;
    const streamPromise = analyzeClipSharpness(tools, videoPath, {
      fps: 30,
      onSample: () => {
        throw streamErr;
      },
    }).finally(() => {
      streamSettled = true;
    });

    streamChild.stdout.write(
      'frame:0 pts:0 pts_time:0\nlavfi.blur=4\nlavfi.signalstats.YAVG=25.5\n' +
        'frame:1 pts:30 pts_time:1\nlavfi.blur=4\nlavfi.signalstats.YAVG=25.5\n',
    );
    await vi.waitFor(() => expect(streamChild.kill).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(streamSettled).toBe(false);
    streamChild.emit('close', null);
    await expect(streamPromise).rejects.toBe(streamErr);

    const flushErr = new Error('consumer failed on flush');
    const flushPromise = analyzeClipSharpness(tools, videoPath, {
      fps: 30,
      onSample: () => {
        throw flushErr;
      },
    });
    flushChild.stdout.end('frame:0 pts:0 pts_time:0\nlavfi.blur=4\nlavfi.signalstats.YAVG=25.5');
    flushChild.stderr.end();
    flushChild.emit('close', 0);
    await expect(flushPromise).rejects.toBe(flushErr);
  });
});
