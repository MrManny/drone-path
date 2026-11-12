import path from 'node:path';
import type * as childProcessModule from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderVideo } from '../src/render.js';
import type { CaptureProgress, RenderJobOptions } from '../src/render.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { FfmpegToolPaths } from '../src/ffmpeg-tools.js';
import { captureFraction, exportReducer, initialExportState } from '../ui/lib/exportstate.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

const mocks = vi.hoisted(() => ({
  exitCode: 0,
  screenshotFailAt: 0,
  screenshots: 0,
  launchFail: false,
  spawnCmds: [] as string[],
  spawnArgs: [] as string[][],
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcessModule>();
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      mocks.spawnCmds.push(cmd);
      mocks.spawnArgs.push(args);
      const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        stdin: InstanceType<typeof PassThrough>;
        stderr: InstanceType<typeof PassThrough>;
        kill: () => void;
      };
      proc.stdin = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = () => {};
      proc.stdin.on('finish', () => proc.emit('close', mocks.exitCode));
      return proc;
    },
  };
});

vi.mock('playwright-core', () => ({
  chromium: {
    launch: async () => {
      if (mocks.launchFail) throw new Error('no chromium here');
      return ({
        newPage: async () => ({
          goto: async () => {},
          waitForFunction: async () => {},
          evaluate: async () => {},
          screenshot: async () => {
            mocks.screenshots++;
            if (mocks.screenshotFailAt > 0 && mocks.screenshots === mocks.screenshotFailAt) {
              throw new Error('screenshot failed');
            }
            return Buffer.from(`frame-${mocks.screenshots}`);
          },
          close: async () => {},
        }),
        close: async () => {},
      });
    },
  },
}));

beforeEach(() => {
  mocks.exitCode = 0;
  mocks.screenshotFailAt = 0;
  mocks.screenshots = 0;
  mocks.launchFail = false;
  mocks.spawnCmds = [];
  mocks.spawnArgs = [];
});

afterEach(cleanupTmpDirs);

const TOOLS: FfmpegToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };

function renderOpts(overrides: Partial<RenderJobOptions> = {}): RenderJobOptions {
  return {
    html: '<html></html>',
    style: 'satellite',
    tileCache: tmpDir(),
    width: 320,
    height: 240,
    frames: 5,
    fpsStr: '30',
    workers: 2,
    outPath: path.join(tmpDir(), 'out.mp4'),
    tools: TOOLS,
    capture: 'jpeg',
    codec: 'h264',
    quality: 'high',
    preset: 'veryfast',
    ...overrides,
  };
}

describe('renderVideo encode and capture failures', () => {
  it('rejects with the ffmpeg error when the encoder exits non-zero', async () => {
    mocks.exitCode = 3;
    await expect(renderVideo(renderOpts())).rejects.toThrow(
      'ffmpeg exited with code 3',
    );
  });

  it('rejects when a screenshot fails', async () => {
    mocks.screenshotFailAt = 2;
    await expect(renderVideo(renderOpts())).rejects.toThrow('screenshot failed');
  });
});

describe('renderVideo browser launch', () => {
  it('keeps every launch attempt as the cause when no browser starts', async () => {
    mocks.launchFail = true;
    const err = await renderVideo(renderOpts()).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toMatch(/could not launch/);
    const cause = err?.cause as AggregateError;
    expect(cause).toBeInstanceOf(AggregateError);
    expect(cause.errors).toHaveLength(3);
    expect(cause.errors.map((e) => (e as Error).message)).toEqual([
      'no chromium here',
      'no chromium here',
      'no chromium here',
    ]);
  });
});

describe('encoder arguments', () => {
  const CRF_CASES = [
    ['h264', 'near-lossless', '16'],
    ['h264', 'high', '18'],
    ['h264', 'medium', '21'],
    ['h264', 'low', '26'],
    ['h265', 'near-lossless', '20'],
    ['h265', 'high', '22'],
    ['h265', 'medium', '25'],
    ['h265', 'low', '30'],
  ] as const;

  it('reproduces the pre-#44 arguments for the default h264 encoding', async () => {
    const opts = renderOpts({ codec: 'h264', quality: 'high', preset: 'medium' });
    await renderVideo(opts);
    expect(mocks.spawnCmds).toEqual([TOOLS.ffmpeg]);
    expect(mocks.spawnArgs).toEqual([
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', '30', '-i', '-',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-r', '30',
        '-movflags', '+faststart', opts.outPath,
      ],
    ]);
  });

  it.each(CRF_CASES)('maps %s quality %s to CRF %s', async (codec, quality, crf) => {
    const opts = renderOpts({ codec, quality });
    await renderVideo(opts);
    const args = mocks.spawnArgs[0];
    const crfAt = args.indexOf('-crf');
    expect(args[crfAt + 1]).toBe(crf);
    expect(args).toContain(codec === 'h265' ? 'libx265' : 'libx264');
  });

  it('tags h265 output hvc1 for player and NLE compatibility', async () => {
    await renderVideo(renderOpts({ codec: 'h265' }));
    const args = mocks.spawnArgs[0];
    const tagAt = args.indexOf('-tag:v');
    expect(args.slice(tagAt, tagAt + 2)).toEqual(['-tag:v', 'hvc1']);
  });

  it('keeps h264 output untagged', async () => {
    await renderVideo(renderOpts({ codec: 'h264' }));
    expect(mocks.spawnArgs[0]).not.toContain('-tag:v');
  });
});

describe('capture progress events', () => {
  it('pair the render emitter with the export UI consumer', async () => {
    const events: CaptureProgress[] = [];
    await renderVideo(renderOpts({ frames: 250, onCapture: (p) => events.push(p) }));

    expect(events).toEqual([
      { done: 100, total: 250 },
      { done: 200, total: 250 },
      { done: 250, total: 250 },
    ]);

    let state = exportReducer(initialExportState(768, 768), {
      type: 'start',
      request: { outPath: '/exports/a.mp4', config: { ...DEFAULT_CONFIG }, range: null },
    });
    const fractions: (number | null)[] = [];
    for (const progress of events) {
      state = exportReducer(state, { type: 'capture', progress });
      fractions.push(captureFraction(state.capture));
    }
    expect(fractions).toEqual([0.4, 0.8, 1]);
  });
});
