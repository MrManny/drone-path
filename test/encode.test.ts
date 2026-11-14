import type * as childProcessModule from 'node:child_process';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  finishEncode,
  formatProfile,
  JPEG_QUALITY,
  OrderedFrameStream,
  spawnEncoder,
} from '../src/encode.js';
import type { Encoder } from '../src/encode.js';
import type { Codec, Quality } from '../src/config.js';

const mocks = vi.hoisted(() => ({
  exitCode: 0,
  spawnCmds: [] as string[],
  spawnArgs: [] as string[][],
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcessModule>();
  const { EventEmitter } = await import('node:events');
  const { PassThrough: PassThroughCtor } = await import('node:stream');
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      mocks.spawnCmds.push(cmd);
      mocks.spawnArgs.push(args);
      const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        stdin: InstanceType<typeof PassThroughCtor>;
        stderr: InstanceType<typeof PassThroughCtor>;
        kill: () => void;
      };
      proc.stdin = new PassThroughCtor();
      proc.stderr = new PassThroughCtor();
      proc.kill = () => {};
      proc.stdin.on('finish', () => proc.emit('close', mocks.exitCode));
      return proc;
    },
  };
});

function fakeEncoder(stdin: PassThrough, overrides: Partial<Encoder> = {}): Encoder {
  return {
    stdin,
    stopped: new Promise<string>(() => {}),
    closed: new Promise<number | null>(() => {}),
    stderrText: () => '',
    kill: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  mocks.exitCode = 0;
  mocks.spawnCmds = [];
  mocks.spawnArgs = [];
});

describe('spawnEncoder arguments', () => {
  it('reproduces the pre-#44 arguments for the default h264 encoding', () => {
    spawnEncoder('/opt/ff/ffmpeg', '30', { codec: 'h264', quality: 'high', preset: 'medium' }, '/x/out.mp4');
    expect(mocks.spawnCmds).toEqual(['/opt/ff/ffmpeg']);
    expect(mocks.spawnArgs).toEqual([
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', '30', '-i', '-',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-r', '30',
        '-movflags', '+faststart', '/x/out.mp4',
      ],
    ]);
  });

  const CRF_CASES: [Codec, Quality, string][] = [
    ['h264', 'near-lossless', '16'],
    ['h264', 'high', '18'],
    ['h264', 'medium', '21'],
    ['h264', 'low', '26'],
    ['h265', 'near-lossless', '20'],
    ['h265', 'high', '22'],
    ['h265', 'medium', '25'],
    ['h265', 'low', '30'],
  ];

  it.each(CRF_CASES)('maps %s quality %s to CRF %s', (codec, quality, crf) => {
    spawnEncoder('/opt/ff/ffmpeg', '30', { codec, quality, preset: 'veryfast' }, '/x/out.mp4');
    const args = mocks.spawnArgs[0];
    const crfAt = args.indexOf('-crf');
    expect(args[crfAt + 1]).toBe(crf);
    expect(args).toContain(codec === 'h265' ? 'libx265' : 'libx264');
  });

  it('tags h265 output hvc1 for player and NLE compatibility', () => {
    spawnEncoder('/opt/ff/ffmpeg', '30', { codec: 'h265', quality: 'high', preset: 'medium' }, '/x/out.mp4');
    const args = mocks.spawnArgs[0];
    const tagAt = args.indexOf('-tag:v');
    expect(args.slice(tagAt, tagAt + 2)).toEqual(['-tag:v', 'hvc1']);
  });

  it('keeps h264 output untagged', () => {
    spawnEncoder('/opt/ff/ffmpeg', '30', { codec: 'h264', quality: 'high', preset: 'medium' }, '/x/out.mp4');
    expect(mocks.spawnArgs[0]).not.toContain('-tag:v');
  });

  it('pins the frame JPEG quality shared by every capture backend', () => {
    expect(JPEG_QUALITY).toBe(95);
  });
});

describe('OrderedFrameStream', () => {
  it('emits frames in index order even when workers finish out of order', async () => {
    const stdin = new PassThrough();
    const chunks: string[] = [];
    stdin.on('data', (d: Buffer) => chunks.push(d.toString()));
    const stream = new OrderedFrameStream(fakeEncoder(stdin));

    await stream.submit(1, Buffer.from('frame-1'));
    await stream.submit(0, Buffer.from('frame-0'));
    await stream.submit(2, Buffer.from('frame-2'));
    stream.end();
    await once(stdin, 'finish');

    expect(chunks.join('')).toBe('frame-0frame-1frame-2');
  });

  it('waits for the drain signal when the encoder applies backpressure', async () => {
    const stdin = new PassThrough({ highWaterMark: 1 });
    const stream = new OrderedFrameStream(fakeEncoder(stdin));

    const submitted = stream.submit(0, Buffer.from('frame-0'));
    stdin.resume();
    await submitted;
  });

  it('wakes with the encoder error when the encoder dies mid-stream', async () => {
    const stdin = new PassThrough({ highWaterMark: 1 });
    const stopped = Promise.resolve('ffmpeg exited with code 1');
    const stream = new OrderedFrameStream(
      fakeEncoder(stdin, { stopped, stderrText: () => 'decoder failure' }),
    );

    await expect(stream.submit(0, Buffer.from('frame-0'))).rejects.toThrow(
      'ffmpeg exited with code 1: decoder failure',
    );
  });
});

describe('finishEncode', () => {
  it('reports the ffmpeg error when the encoder exits non-zero', async () => {
    const stdin = new PassThrough();
    stdin.resume();
    const encoder = fakeEncoder(stdin, {
      closed: Promise.resolve(3),
      stderrText: () => 'bad frames',
    });
    const stream = new OrderedFrameStream(encoder);

    await expect(finishEncode(encoder, stream, () => {}, '/x/out.mp4')).rejects.toThrow(
      'ffmpeg exited with code 3: bad frames',
    );
  });

  it('logs the encoded file after a clean exit', async () => {
    const stdin = new PassThrough();
    stdin.resume();
    const encoder = fakeEncoder(stdin, { closed: Promise.resolve(0) });
    const stream = new OrderedFrameStream(encoder);
    const logs: string[] = [];

    await finishEncode(encoder, stream, (msg) => logs.push(msg), '/x/out.mp4');

    expect(logs).toEqual(['encoded: /x/out.mp4']);
  });
});

describe('formatProfile', () => {
  it('keeps the CLI wording the desktop progress consumer parses', () => {
    const line = formatProfile({ evalMs: 1500, captureMs: 2500, emitMs: 500 }, 2);
    expect(line).toBe(
      'profile: eval=1.5s capture=2.5s encode-backpressure=0.5s (summed over 2 workers)',
    );
  });
});
