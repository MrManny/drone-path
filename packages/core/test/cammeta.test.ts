import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type * as childProcessModule from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';
import { camMetaMp4 } from '../../../test/fixtures/mp4-cammeta.js';
import { parseCamMeta } from '../src/cammeta.js';
import type * as ffmpegModule from '../src/ffmpeg.js';
import type { FfmpegToolPaths } from '../src/ffmpeg-tools.js';

const TOOLS: FfmpegToolPaths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

const mocks = vi.hoisted(() => ({
  ffprobeJson: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('../src/ffmpeg.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ffmpegModule>()),
  ffprobeJson: mocks.ffprobeJson,
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcessModule>()),
  execFile: mocks.execFile,
}));

describe('parseCamMeta failure surfacing', () => {
  const VIDEO = 'clips/flight.mp4';

  beforeEach(() => {
    mocks.ffprobeJson.mockReset();
    mocks.execFile.mockReset();
  });

  it('returns null when the video has no CAM meta stream', async () => {
    mocks.ffprobeJson.mockResolvedValue({ streams: [] });
    await expect(parseCamMeta(TOOLS, VIDEO, 1)).resolves.toBeNull();
  });

  it('rethrows ffprobe stream probing failures with their cause', async () => {
    const failure = new Error('spawn ffprobe ENOENT');
    mocks.ffprobeJson.mockRejectedValue(failure);
    const err = await parseCamMeta(TOOLS, VIDEO, 1).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toBe('ffprobe failed while probing the cam meta stream');
    expect(err?.cause).toBe(failure);
  });

  it('rethrows ffprobe packet listing failures with their cause', async () => {
    const failure = new Error('ffprobe crashed');
    mocks.ffprobeJson
      .mockResolvedValueOnce({ streams: [{ index: 3, tags: { handler_name: 'CAM meta' } }] })
      .mockRejectedValueOnce(failure);
    const err = await parseCamMeta(TOOLS, VIDEO, 1).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toBe('ffprobe failed while listing the cam meta packets');
    expect(err?.cause).toBe(failure);
  });

  it('rethrows ffmpeg dump failures with their cause', async () => {
    const tools = { ffmpeg: '/resolved/ffmpeg', ffprobe: '/resolved/ffprobe' };
    const failure = new Error('spawn ffmpeg ENOENT');
    mocks.ffprobeJson
      .mockResolvedValueOnce({ streams: [{ index: 3, tags: { handler_name: 'CAM meta' } }] })
      .mockResolvedValueOnce({ packets: [{ pts_time: '0', size: '5' }] });
    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null) => void) =>
        cb(failure),
    );
    const err = await parseCamMeta(tools, VIDEO, 1).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(mocks.execFile.mock.calls[0][0]).toBe('/resolved/ffmpeg');
    expect(err?.message).toBe('ffmpeg failed while dumping the cam meta stream');
    expect(err?.cause).toBe(failure);
  });
});

describe('parseCamMeta stream presence contract', () => {
  const VIDEO = 'clips/flight.mp4';

  beforeEach(() => {
    mocks.ffprobeJson.mockReset();
    mocks.execFile.mockReset();
  });

  function mockDump(
    packets: Array<{ pts_time: string; size: string }>,
    dump: Buffer,
  ): void {
    mocks.ffprobeJson
      .mockResolvedValueOnce({ streams: [{ index: 3, tags: { handler_name: 'CAM meta' } }] })
      .mockResolvedValueOnce({ packets });
    mocks.execFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: (e: null, result: { stdout: Buffer }) => void) => {
        expect(args.at(-1)).toBe('pipe:1');
        cb(null, { stdout: dump });
      },
    );
  }

  const EMPTY_CASES: Array<{
    name: string;
    packets: Array<{ pts_time: string; size: string }>;
    dump: Buffer;
  }> = [
    { name: 'an empty dump', packets: [], dump: Buffer.alloc(0) },
    {
      name: 'a dump without GPS pairs',
      packets: [{ pts_time: '0', size: '5' }],
      dump: Buffer.alloc(64, 0x20),
    },
    {
      name: 'a dump with an empty packet listing',
      packets: [],
      dump: Buffer.alloc(64, 0x20),
    },
  ];

  it.for(EMPTY_CASES)(
    '$name yields empty samples instead of null',
    async ({ packets, dump }) => {
      mockDump(packets, dump);
      const result = await parseCamMeta(TOOLS, VIDEO, 1, { keepAll: true });
      expect(result).not.toBeNull();
      expect(result?.samples).toEqual([]);
      expect(result?.method).toBe('cammeta-scan');
      expect(result?.protoFile).toBeNull();
      expect(result?.gimbalDevice).toBeNull();
    },
  );
});

describe('direct CAM meta extraction', () => {
  afterEach(cleanupTmpDirs);

  it('matches tool decoding and falls back after discovering an unsupported MP4', async () => {
    const { buffer, packets, file } = camMetaMp4();
    const video = path.join(tmpDir(), 'cammeta.mp4');
    writeFileSync(video, file);
    const opts = { keepAll: true, stream: { index: 2, trackId: 3 } };
    mocks.ffprobeJson.mockReset();
    mocks.execFile.mockReset();

    const direct = await parseCamMeta(TOOLS, video, 0.101, opts);

    expect(direct?.method).toBe('dvtm-packets');
    expect(direct?.samples.map((sample) => sample.tSec)).toEqual([0, 0.033367, 0.066733]);
    expect(direct?.noLock).toBe(1);
    expect(mocks.ffprobeJson).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();

    writeFileSync(video, camMetaMp4('fragmented').file);
    mocks.ffprobeJson.mockResolvedValue({
      packets: packets.map(({ tSec, size }) => ({ pts_time: String(tSec), size: String(size) })),
    });
    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (e: null, result: { stdout: Buffer }) => void) =>
        cb(null, { stdout: buffer }),
    );

    await expect(parseCamMeta(TOOLS, video, 0.101, opts)).resolves.toEqual(direct);
    expect(mocks.ffprobeJson).toHaveBeenCalledTimes(1);
    expect(mocks.ffprobeJson.mock.calls[0][2]).toContain('packet=pts_time,size');
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });
});
