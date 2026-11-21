import { describe, expect, it } from 'vitest';

import { mocks, renderOpts, TOOLS } from '../../../test/fixtures/render.js';
import { renderVideo } from '../src/render.js';

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
