import path from 'node:path';
import type * as childProcessModule from 'node:child_process';

import { afterEach, beforeEach, vi } from 'vitest';

import type { RenderJobOptions } from 'drone-path-engine/render';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import { cleanupTmpDirs, tmpDir } from './core.js';

const mocks = vi.hoisted(() => ({
  exitCode: 0,
  screenshotFailAt: 0,
  screenshots: 0,
  launchFail: false,
  spawnCmds: [] as string[],
  spawnArgs: [] as string[][],
  spawnOpts: [] as Array<childProcessModule.SpawnOptions | undefined>,
  spawnError: null as Error | null,
  killed: 0,
  closeDelayMs: 0,
}));

export { mocks };

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcessModule>();
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return {
    ...actual,
    spawn: (cmd: string, args: string[], opts?: childProcessModule.SpawnOptions) => {
      mocks.spawnCmds.push(cmd);
      mocks.spawnArgs.push(args);
      mocks.spawnOpts.push(opts);
      const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        stdin: InstanceType<typeof PassThrough>;
        stderr: InstanceType<typeof PassThrough>;
        kill: () => void;
      };
      proc.stdin = new PassThrough();
      proc.stderr = new PassThrough();
      let closed = false;
      const emitClose = (code: number | null): void => {
        if (closed) return;
        closed = true;
        proc.emit('close', code);
      };
      proc.kill = () => {
        mocks.killed++;
        if (mocks.closeDelayMs > 0) {
          setTimeout(() => emitClose(null), mocks.closeDelayMs);
        } else {
          queueMicrotask(() => emitClose(null));
        }
      };
      proc.stdin.on('finish', () => emitClose(mocks.exitCode));
      if (mocks.spawnError) {
        const err = mocks.spawnError;
        queueMicrotask(() => proc.emit('error', err));
      }
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
  mocks.spawnOpts = [];
  mocks.spawnError = null;
  mocks.killed = 0;
  mocks.closeDelayMs = 0;
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
