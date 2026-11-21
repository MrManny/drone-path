import http from 'node:http';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { mocks, renderOpts, TOOLS } from '../../../test/fixtures/render.js';
import { OrderedFrameStream, renderVideo } from '../src/render.js';

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

  it('rejects cleanly without an unhandled error when ffmpeg fails to spawn', async () => {
    mocks.spawnError = new Error('spawn /opt/ff/ffmpeg ENOENT');
    await expect(renderVideo(renderOpts())).rejects.toThrow(
      'ffmpeg process error: spawn /opt/ff/ffmpeg ENOENT',
    );
  });

  it('rejects cleanly when the local render server fails to listen', async () => {
    const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(
      () =>
        ({
          once: vi.fn((event: string, cb: (err: Error) => void) => {
            if (event === 'error') queueMicrotask(() => cb(new Error('EACCES: permission denied')));
          }),
          off: vi.fn(),
          on: vi.fn(),
          listen: vi.fn(),
          close: vi.fn(),
        }) as unknown as http.Server,
    );

    try {
      await expect(renderVideo(renderOpts())).rejects.toThrow(
        'local render server error: EACCES: permission denied',
      );
    } finally {
      createServerSpy.mockRestore();
    }
  });

  it('awaits encoder exit before rejecting after a failure', async () => {
    mocks.screenshotFailAt = 2;
    mocks.closeDelayMs = 40;
    const start = Date.now();

    await expect(renderVideo(renderOpts())).rejects.toThrow('screenshot failed');
    expect(mocks.killed).toBe(1);
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
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

  it('spawns ffmpeg with windowsHide enabled', async () => {
    await renderVideo(renderOpts());
    expect(mocks.spawnOpts[0]).toMatchObject({
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
  });
});

describe('OrderedFrameStream backpressure', () => {
  function backpressuredEncoder() {
    let releaseDrain: (() => void) | null = null;
    const written: string[] = [];
    const stdin = new Writable({
      highWaterMark: 1,
      write(chunk: Buffer, _enc, cb) {
        written.push(chunk.toString());
        releaseDrain = cb;
      },
    });
    return {
      stdin,
      written,
      drainNext: (): void => {
        const cb = releaseDrain;
        releaseDrain = null;
        cb?.();
      },
      stopped: new Promise<string>(() => {}),
      stderrText: () => '',
    };
  }

  it('pauses all workers while stdin is draining instead of buffering unbounded frames', async () => {
    const encoder = backpressuredEncoder();
    const stream = new OrderedFrameStream(encoder, 3);

    const w1 = stream.submit(0, Buffer.from('f0'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(encoder.written).toEqual(['f0']);

    let w2Done = false;
    let w3Done = false;
    const w2 = stream.submit(1, Buffer.from('f1')).then(() => {
      w2Done = true;
    });
    const w3 = stream.submit(2, Buffer.from('f2')).then(() => {
      w3Done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Both remaining workers must stay blocked until frame 0 drains and their frames flush.
    expect(w2Done).toBe(false);
    expect(w3Done).toBe(false);

    encoder.drainNext();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(encoder.written).toEqual(['f0', 'f1']);
    expect(w2Done).toBe(false);

    encoder.drainNext();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(encoder.written).toEqual(['f0', 'f1', 'f2']);

    encoder.drainNext();
    await Promise.all([w1, w2, w3]);
    expect(w2Done).toBe(true);
    expect(w3Done).toBe(true);
  });

  it('bounds out-of-order buffered frames across workers when an earlier frame is delayed', async () => {
    const written: string[] = [];
    const stdin = new Writable({
      write(chunk: Buffer, _enc, cb) {
        written.push(chunk.toString());
        cb();
      },
    });
    const stream = new OrderedFrameStream(
      { stdin, stopped: new Promise<string>(() => {}), stderrText: () => '' },
      2,
    );

    // Worker 2 submits frame 1 (< maxPending=2), then frame 2 (reaches maxPending=2 and blocks).
    await stream.submit(1, Buffer.from('f1'));
    let blockedDone = false;
    const blocked = stream.submit(2, Buffer.from('f2')).then(() => {
      blockedDone = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(blockedDone).toBe(false);
    expect(written).toEqual([]);

    // Worker 1 delivers frame 0, flushing 0..2 in order and unblocking worker 2.
    await stream.submit(0, Buffer.from('f0'));
    await blocked;
    expect(blockedDone).toBe(true);
    expect(written).toEqual(['f0', 'f1', 'f2']);
  });

  it('unblocks waiting workers with the error when aborted', async () => {
    const encoder = backpressuredEncoder();
    const stream = new OrderedFrameStream(encoder, 2);

    const w1 = stream.submit(0, Buffer.from('f0'));
    const w2 = stream.submit(1, Buffer.from('f1'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    stream.abort(new Error('render canceled'));
    await expect(w1).rejects.toThrow('render canceled');
    await expect(w2).rejects.toThrow('render canceled');
  });
});
