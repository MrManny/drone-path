import type * as childProcessModule from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runTool } from '../src/exec-tool.js';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcessModule>()),
  execFile: mocks.execFile,
}));

beforeEach(() => {
  mocks.execFile.mockReset();
});

describe('runTool', () => {
  it('passes the command, argv and buffer budget through untouched', async () => {
    mocks.execFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (e: null, result: { stdout: string; stderr: string }) => void,
      ) => cb(null, { stdout: 'ok', stderr: '' }),
    );

    await expect(runTool('ffprobe', ['-v', 'error'], { maxBuffer: 42 })).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
    });
    expect(mocks.execFile.mock.calls[0].slice(0, 3)).toEqual([
      'ffprobe',
      ['-v', 'error'],
      { maxBuffer: 42 },
    ]);
  });

  it('propagates the spawned error unwrapped so callers can wrap it with cause', async () => {
    const failure = new Error('spawn ffmpeg ENOENT');
    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null) => void) =>
        cb(failure),
    );

    await expect(runTool('ffmpeg', ['-version'])).rejects.toBe(failure);
  });
});
