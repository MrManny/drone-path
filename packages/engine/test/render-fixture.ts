import path from 'node:path';
import type * as childProcessModule from 'node:child_process';

import { afterEach, beforeEach, vi } from 'vitest';

import type { RenderJobOptions } from '../src/render.js';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import { cleanupTmpDirs, tmpDir } from '../../core/test/fixtures.js';

const mocks = vi.hoisted(() => ({
  exitCode: 0,
  screenshotFailAt: 0,
  screenshots: 0,
  launchFail: false,
  spawnCmds: [] as string[],
  spawnArgs: [] as string[][],
}));

export { mocks };

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

export const TOOLS: FfmpegToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };

export function renderOpts(overrides: Partial<RenderJobOptions> = {}): RenderJobOptions {
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
