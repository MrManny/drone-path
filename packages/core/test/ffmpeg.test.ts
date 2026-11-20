import type * as childProcessModule from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireFfmpegTools } from '../src/ffmpeg.js';
import type { FfmpegToolPaths } from '../src/ffmpeg-tools.js';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcessModule>()),
  execFile: mocks.execFile,
}));

const tools: FfmpegToolPaths = { ffmpeg: '/opt/ff/ffmpeg', ffprobe: '/opt/ff/ffprobe' };

beforeEach(() => {
  mocks.execFile.mockReset();
});

describe('requireFfmpegTools', () => {
  it('resolves when both tools respond, probing the resolved paths', async () => {
    mocks.execFile.mockImplementation(
      (
        _tool: string,
        _args: string[],
        _opts: unknown,
        cb: (e: null, result: { stdout: string; stderr: string }) => void,
      ) => cb(null, { stdout: 'ok', stderr: '' }),
    );
    await expect(requireFfmpegTools(tools)).resolves.toBeUndefined();
    expect(mocks.execFile.mock.calls.map((c) => c[0])).toEqual([
      '/opt/ff/ffmpeg',
      '/opt/ff/ffprobe',
    ]);
  });

  it.each(['ffmpeg', 'ffprobe'] as const)(
    'keeps the %s failure as the cause',
    async (tool) => {
      const failure = new Error(`spawn ${tool} ENOENT`);
      mocks.execFile.mockImplementation(
        (
          running: string,
          _args: string[],
          _opts: unknown,
          cb: (e: Error | null, result?: unknown) => void,
        ) =>
          running === tools[tool] ? cb(failure) : cb(null, { stdout: 'ok', stderr: '' }),
      );
      const err = await requireFfmpegTools(tools).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toContain(`${tool} is required but could not be run`);
      expect(err?.message).toContain('--ffmpeg/--ffprobe');
      expect(err?.cause).toBe(failure);
    },
  );
});
