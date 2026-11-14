import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Writable } from 'node:stream';

import type { Codec, EncodeSettings, Quality } from './config.js';

// Frame capture quality shared by every capture backend (Playwright's
// screenshot and Electron's capturePage) so CLI and desktop exports carry the
// same frame bytes.
export const JPEG_QUALITY = 95;

export interface Encoder {
  stdin: Writable;
  stopped: Promise<string>;
  closed: Promise<number | null>;
  stderrText(): string;
  kill(): void;
}

// x265's CRF scale sits ~5 points above x264's for the same perceived quality.
const CRF: Record<Codec, Record<Quality, number>> = {
  h264: { 'near-lossless': 16, high: 18, medium: 21, low: 26 },
  h265: { 'near-lossless': 20, high: 22, medium: 25, low: 30 },
};

export function spawnEncoder(
  ffmpeg: string,
  fpsStr: string,
  encode: EncodeSettings,
  outPath: string,
): Encoder {
  // h265 gets hvc1: the ffmpeg-default hev1 tag is refused by QuickTime and some NLEs.
  const codecArgs =
    encode.codec === 'h265' ? ['-c:v', 'libx265', '-tag:v', 'hvc1'] : ['-c:v', 'libx264'];
  const ffmpegProcess = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', fpsStr, '-i', '-',
    ...codecArgs,
    '-preset', encode.preset,
    '-crf', String(CRF[encode.codec][encode.quality]),
    '-pix_fmt', 'yuv420p', '-r', fpsStr,
    '-movflags', '+faststart', outPath,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let stderr = '';
  ffmpegProcess.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });

  // ffmpeg's stdin must never surface an unhandled 'error' (EPIPE on early exit); a drain-waiter must wake when the encoder dies.
  const closed = new Promise<number | null>((resolve) => {
    ffmpegProcess.once('close', (code) => resolve(code));
  });
  const stopped = new Promise<string>((resolve) => {
    ffmpegProcess.stdin.on('error', (e: Error) => resolve(`ffmpeg stdin error: ${e.message}`));
    void closed.then((code) => resolve(`ffmpeg exited with code ${code}`));
  });

  return {
    stdin: ffmpegProcess.stdin,
    stopped,
    closed,
    stderrText: () => stderr,
    kill: () => ffmpegProcess.kill(),
  };
}

// Frames may complete out of order (parallel workers) but must reach ffmpeg
// in capture order.
export class OrderedFrameStream {
  private readonly pending = new Map<number, Buffer>();
  private nextIndex = 0;

  constructor(private readonly encoder: Encoder) {}

  async submit(index: number, frame: Buffer): Promise<void> {
    this.pending.set(index, frame);
    await this.flushReady();
  }

  async flushReady(): Promise<void> {
    while (this.pending.has(this.nextIndex)) {
      const frame = this.pending.get(this.nextIndex) as Buffer;
      this.pending.delete(this.nextIndex);
      if (!this.encoder.stdin.write(frame)) {
        const woke = await Promise.race([
          once(this.encoder.stdin, 'drain').then(() => 'drain' as const),
          this.encoder.stopped,
        ]);
        if (woke !== 'drain') {
          const stderr = this.encoder.stderrText().trim();
          throw new Error(`${woke}${stderr ? `: ${stderr}` : ''}`);
        }
      }
      this.nextIndex++;
    }
  }

  end(): void {
    this.encoder.stdin.end();
  }
}

export async function finishEncode(
  encoder: Encoder,
  stream: OrderedFrameStream,
  log: (msg: string) => void,
  outPath: string,
): Promise<void> {
  await stream.flushReady();
  stream.end();
  const code = await encoder.closed;
  if (code !== 0) {
    throw new Error(`ffmpeg exited with code ${code}: ${encoder.stderrText().trim()}`);
  }
  log(`encoded: ${outPath}`);
}

export interface RenderProfile {
  evalMs: number;
  captureMs: number;
  emitMs: number;
}

export function formatProfile(profile: RenderProfile, workerCount: number): string {
  return (
    `profile: eval=${(profile.evalMs / 1000).toFixed(1)}s capture=${(profile.captureMs / 1000).toFixed(1)}s ` +
    `encode-backpressure=${(profile.emitMs / 1000).toFixed(1)}s (summed over ${workerCount} workers)`
  );
}
