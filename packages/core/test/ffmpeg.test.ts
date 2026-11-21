import type * as childProcessModule from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { probeVideo, requireFfmpegTools } from '../src/ffmpeg.js';
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

describe('probeVideo', () => {
  it('probes the first video, CAM meta stream, and camera timestamp together', async () => {
    const creationTime = '2025-02-03T04:05:06.000000Z';
    const streams = [
      { index: 0, codec_type: 'audio' },
      { index: 1, codec_type: 'video', r_frame_rate: '30/1', nb_frames: '30', width: 1280, height: 720 },
      { index: 2, codec_type: 'video', r_frame_rate: '15/1', nb_frames: '15', width: 640, height: 480 },
      { index: 3, id: '0x4', codec_type: 'data', tags: { handler_name: 'CAM meta' } },
    ];
    const stdout = JSON.stringify({ streams, format: { duration: '1', tags: { creation_time: creationTime } } });
    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (e: null, result: { stdout: string }) => void) =>
        cb(null, { stdout }),
    );

    const probe = await probeVideo(tools, 'recording.mp4');

    expect(probe).toMatchObject({
      fps: { value: 30 },
      frames: 30,
      durationSec: 1,
      width: 1280,
      height: 720,
      creationTime,
      camMeta: { index: 3, trackId: 4 },
    });
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.execFile.mock.calls[0][1]).toContain(
      'stream=index,id,codec_type,r_frame_rate,avg_frame_rate,nb_frames,width,height' +
        ':stream_tags=handler_name:format=duration:format_tags=creation_time',
    );
  });
});
