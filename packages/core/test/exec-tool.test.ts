import type * as childProcessModule from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runTool, spawnTool } from '../src/exec-tool.js';

const mocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcessModule>()),
  execFile: mocks.execFile,
  spawn: mocks.spawn,
}));

beforeEach(() => {
  mocks.execFile.mockReset();
  mocks.spawn.mockReset();
});

describe('runTool', () => {
  it('passes the command, argv and buffer budget through with windowsHide enabled', async () => {
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
      { windowsHide: true, maxBuffer: 42 },
    ]);
  });

  it('defaults windowsHide to true when options are omitted and lets callers override it', async () => {
    mocks.execFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (e: null, result: { stdout: string; stderr: string }) => void,
      ) => cb(null, { stdout: 'ok', stderr: '' }),
    );

    await runTool('ffprobe', ['-version']);
    await runTool('ffprobe', ['-version'], { windowsHide: false });

    expect(mocks.execFile.mock.calls[0][2]).toEqual({ windowsHide: true });
    expect(mocks.execFile.mock.calls[1][2]).toEqual({ windowsHide: false });
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

describe('spawnTool', () => {
  it('defaults windowsHide to true while forwarding command, args, and options', () => {
    const fakeChild = { pid: 123 };
    mocks.spawn.mockReturnValue(fakeChild);

    expect(spawnTool('ffmpeg', ['-v', 'error'], { stdio: ['ignore', 'pipe', 'pipe'] })).toBe(
      fakeChild,
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      'ffmpeg',
      ['-v', 'error'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });
});
