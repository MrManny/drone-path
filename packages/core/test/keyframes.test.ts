import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTmpDirs, probeFixture, tmpDir } from '../../../test/fixtures/core.js';
import * as execTool from '../src/exec-tool.js';
import * as ffmpeg from '../src/ffmpeg.js';
import type { FfmpegToolPaths } from '../src/ffmpeg-tools.js';
import { extractKeyframes, parseKeyframeSpecs } from '../src/keyframes.js';
import * as telemetry from '../src/telemetry.js';
import type { SourceSamples } from '../src/telemetry.js';

vi.mock('../src/exec-tool.js', { spy: true });
vi.mock('../src/ffmpeg.js', { spy: true });
vi.mock('../src/telemetry.js', { spy: true });

const tools: FfmpegToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanupTmpDirs();
});

describe('parseKeyframeSpecs', () => {
  it.for([
    ['0', [{ kind: 'time', tSec: 0 }]],
    ['2.5', [{ kind: 'time', tSec: 2.5 }]],
    ['12.5s', [{ kind: 'time', tSec: 12.5 }]],
    ['1.5S,f90,frame:120,FRAME:0', [
      { kind: 'time', tSec: 1.5 },
      { kind: 'frame', frame: 90 },
      { kind: 'frame', frame: 120 },
      { kind: 'frame', frame: 0 },
    ]],
    [' 2s , F42 ', [
      { kind: 'time', tSec: 2 },
      { kind: 'frame', frame: 42 },
    ]],
  ] as const)('parses valid keyframe spec %s', ([spec, expected]) => {
    expect(parseKeyframeSpecs(spec)).toEqual(expected);
  });

  it.for([
    '',
    '   ',
    '1,,2',
    ',1',
    '1,',
    '-1',
    '-0.5s',
    'NaN',
    'Infinity',
    'f-1',
    'f1.5',
    'frame:',
    'f',
    'foo',
    '12ms',
  ])('rejects invalid keyframe spec %j with a lowercase Error', (spec) => {
    expect(() => parseKeyframeSpecs(spec)).toThrow();
    try {
      parseKeyframeSpecs(spec);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).toMatch(/^[a-z]/u);
    }
  });
});

describe('extractKeyframes', () => {
  it('validates requests against duration and frame count before invoking ffmpeg', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    vi.mocked(ffmpeg.probeVideo).mockResolvedValue(
      probeFixture({ frames: 90, durationSec: 3, width: 1920, height: 1080 }),
    );
    const runSpy = vi.mocked(execTool.runTool);

    await expect(
      extractKeyframes(videoPath, { at: [{ kind: 'time', tSec: 3.1 }], tools }),
    ).rejects.toThrow(/out of range/);
    await expect(
      extractKeyframes(videoPath, { at: [{ kind: 'frame', frame: 90 }], tools }),
    ).rejects.toThrow(/out of range/);
    await expect(
      extractKeyframes(videoPath, { at: [], tools }),
    ).rejects.toThrow(/at least one keyframe/);
    await expect(
      extractKeyframes(videoPath, { at: [{ kind: 'time', tSec: 1 }], maxWidth: 0, tools }),
    ).rejects.toThrow(/positive integer/);

    expect(runSpy).not.toHaveBeenCalled();
  });

  it('uses fast input seeking (-ss before -i), scales preserving even aspect ratio, and attaches telemetry snapshots', async () => {
    const dir = tmpDir();
    const outDir = path.join(dir, 'frames');
    const videoPath = path.join(dir, 'DJI_0001.MP4');

    vi.mocked(ffmpeg.probeVideo).mockResolvedValue(
      probeFixture({
        fps: { num: 30, den: 1, value: 30, str: '30' },
        frames: 300,
        durationSec: 10,
        width: 1920,
        height: 1080,
        camMeta: { index: 2, trackId: 3 },
      }),
    );

    const loaded: SourceSamples = {
      source: 'cammeta',
      method: 'dvtm-packets',
      noLock: 0,
      protoFile: null,
      gimbalDevice: null,
      samples: [
        { tSec: 0, fix: { lat: 46.6, lon: 14.2 }, relAlt: 10, absAlt: 310, yawDeg: 90 },
        { tSec: 3, fix: { lat: 46.601, lon: 14.201 }, relAlt: 15, absAlt: 315, yawDeg: 95 },
      ],
      frameValues: [],
      trackValues: [
        {
          tSec: 0,
          lat: 46.6,
          lng: 14.2,
          altRel: 10,
          altAbs: 310,
          yawDeg: 90,
          gimbalPitchDeg: -15,
          gimbalYawDeg: 5,
          iso: 100,
          shutterTime: 0.0025,
        },
        {
          tSec: 3,
          lat: 46.601,
          lng: 14.201,
          altRel: 15,
          altAbs: 315,
          yawDeg: 95,
          gimbalPitchDeg: -22.5,
          gimbalYawDeg: 12,
          iso: 200,
          shutterTime: 0.005,
        },
      ],
    };
    vi.mocked(telemetry.loadTelemetrySamples).mockResolvedValue(loaded);
    vi.mocked(execTool.runTool).mockImplementation(async (_cmd, args) => {
      const outPath = args[args.length - 1];
      fs.writeFileSync(outPath, 'jpeg');
      return { stdout: '', stderr: '' };
    });

    const results = await extractKeyframes(videoPath, {
      at: [
        { kind: 'time', tSec: 3 },
        { kind: 'frame', frame: 0 },
      ],
      maxWidth: 500,
      outDir,
      tools,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      path: path.join(outDir, 'DJI_0001_f90_3000ms.jpg'),
      tSec: 3,
      frame: 90,
      width: 500,
      height: 282,
      telemetry: {
        lat: 46.601,
        lon: 14.201,
        altRelM: 15,
        altAbsM: 315,
        gimbalPitchDeg: -22.5,
        gimbalYawDeg: 12,
        iso: 200,
        shutterTime: 0.005,
      },
    });
    expect(results[0].telemetry?.speedMps).toBeTypeOf('number');
    expect(results[0].telemetry?.headingDeg).toBeTypeOf('number');

    expect(results[1]).toMatchObject({
      path: path.join(outDir, 'DJI_0001_f0_0ms.jpg'),
      tSec: 0,
      frame: 0,
      width: 500,
      height: 282,
    });

    const firstArgs = vi.mocked(execTool.runTool).mock.calls[0][1];
    expect(firstArgs.indexOf('-ss')).toBeLessThan(firstArgs.indexOf('-i'));
    expect(firstArgs).toContain('scale=500:282');
    expect(fs.existsSync(results[0].path)).toBe(true);
    expect(fs.existsSync(results[1].path)).toBe(true);
  });

  it('avoids filename collisions when multiple targets round to the same frame or timestamp', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    vi.mocked(ffmpeg.probeVideo).mockResolvedValue(
      probeFixture({ frames: 90, durationSec: 3, width: 1280, height: 720 }),
    );
    vi.mocked(telemetry.loadTelemetrySamples).mockResolvedValue(null);
    vi.mocked(execTool.runTool).mockResolvedValue({ stdout: '', stderr: '' });

    const results = await extractKeyframes(videoPath, {
      at: [
        { kind: 'time', tSec: 1.0 },
        { kind: 'time', tSec: 1.01 },
        { kind: 'frame', frame: 30 },
      ],
      tools,
    });

    const paths = results.map((r) => r.path);
    expect(new Set(paths).size).toBe(3);
    expect(paths[0]).toBe(path.join(dir, 'clip_f30_1000ms.jpg'));
    expect(paths[1]).toBe(path.join(dir, 'clip_f30_1010ms.jpg'));
    expect(paths[2]).toBe(path.join(dir, 'clip_f30_1000ms_2.jpg'));
    expect(results.every((r) => r.telemetry === null)).toBe(true);
  });

  it('populates TrackRecord fields when fewer than 2 GPS fixes are available', async () => {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'indoor.mp4');
    vi.mocked(ffmpeg.probeVideo).mockResolvedValue(
      probeFixture({ frames: 60, durationSec: 2, width: 1920, height: 1080 }),
    );
    vi.mocked(telemetry.loadTelemetrySamples).mockResolvedValue({
      source: 'cammeta',
      method: 'dvtm-packets',
      noLock: 1,
      protoFile: null,
      gimbalDevice: null,
      samples: [],
      frameValues: [],
      trackValues: [
        {
          tSec: 1,
          lat: null,
          lng: null,
          gimbalPitchDeg: -10,
          gimbalYawDeg: 3,
          iso: 400,
          shutterTime: 0.01,
        },
      ],
    });
    vi.mocked(execTool.runTool).mockResolvedValue({ stdout: '', stderr: '' });

    const [kf] = await extractKeyframes(videoPath, {
      at: [{ kind: 'time', tSec: 1 }],
      tools,
    });

    expect(kf.width).toBe(1920);
    expect(kf.height).toBe(1080);
    expect(kf.telemetry).toEqual({
      lat: null,
      lon: null,
      altRelM: null,
      altAbsM: null,
      speedMps: null,
      headingDeg: null,
      gimbalPitchDeg: -10,
      gimbalYawDeg: 3,
      iso: 400,
      shutterTime: 0.01,
    });
  });
});
