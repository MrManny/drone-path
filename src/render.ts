import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Writable } from 'node:stream';

import type { Browser, Page } from 'playwright-core';

import { MIME } from './assets.js';
import { errorMessage } from './errors.js';
import { RENDERER_DIR, serveAsset } from './serve.js';
import type { CaptureFormat, Codec, EncodeSettings, EncoderPreset, Quality, MapStyle } from './config.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';

const PAGE_LOAD_TIMEOUT_MS = 60000;
const SCREENSHOT_TIMEOUT_MS = 60000;

interface ServerHandle {
  server: http.Server;
  url: string;
}

function startServer({
  html,
  style,
  tileCache,
}: {
  html: string;
  style: MapStyle;
  tileCache: string;
}): Promise<ServerHandle> {
  const server = http.createServer((req, res) => {
    let url: string;
    try {
      url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
      return;
    }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(html);
      return;
    }
    if (serveAsset(url, res, { style, tileCache, rendererDir: RENDERER_DIR })) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

interface LaunchAttempt {
  executablePath?: string;
  channel?: string;
}

async function launchBrowser(
  log: (msg: string) => void,
  browserPath: string | null,
): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  const attempts: LaunchAttempt[] = [];
  if (browserPath) attempts.push({ executablePath: browserPath });
  attempts.push({ channel: 'chrome' }, { channel: 'msedge' }, {});
  const attemptErrors: unknown[] = [];
  for (const opt of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, ...opt });
      log(`browser: ${opt.executablePath ?? opt.channel ?? 'playwright-registry'}`);
      return browser;
    } catch (e) {
      attemptErrors.push(e);
    }
  }
  throw new Error(
    `could not launch a Chromium browser (tried explicit path, channel=chrome, channel=msedge, playwright registry): ${errorMessage(attemptErrors[attemptErrors.length - 1])}. ` +
      'Install Google Chrome or Microsoft Edge, run "npx playwright install chromium", ' +
      'or pass --browser <path>.',
    { cause: new AggregateError(attemptErrors, 'all browser launch attempts failed') },
  );
}

interface Encoder {
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

function spawnEncoder(
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

class OrderedFrameStream {
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

function screenshotOptions(capture: CaptureFormat) {
  return capture === 'jpeg'
    ? {
        type: 'jpeg' as const,
        quality: 95,
        animations: 'disabled' as const,
        timeout: SCREENSHOT_TIMEOUT_MS,
      }
    : {
        type: 'png' as const,
        animations: 'disabled' as const,
        timeout: SCREENSHOT_TIMEOUT_MS,
      };
}

export interface CaptureProgress {
  done: number;
  total: number;
}

export interface RenderJobOptions {
  html: string;
  style: MapStyle;
  tileCache: string;
  width: number;
  height: number;
  frames: number;
  frameStart?: number;
  fpsStr: string;
  workers: number;
  outPath: string;
  log?: (msg: string) => void;
  browserPath?: string | null;
  tools: FfmpegToolPaths;
  capture: CaptureFormat;
  codec: Codec;
  quality: Quality;
  preset: EncoderPreset;
  signal?: AbortSignal;
  onCapture?: (progress: CaptureProgress) => void;
}

export interface RenderProfile {
  evalMs: number;
  captureMs: number;
  emitMs: number;
}

interface StageTiming {
  evalMs: number;
  captureMs: number;
  emitMs: number;
}

interface RenderContext {
  width: number;
  height: number;
  frames: number;
  frameStart: number;
  fpsStr: string;
  outPath: string;
  capture: CaptureFormat;
  codec: Codec;
  quality: Quality;
  preset: EncoderPreset;
  signal: AbortSignal | undefined;
  log: (msg: string) => void;
  onCapture: ((progress: CaptureProgress) => void) | undefined;
  tools: FfmpegToolPaths;
}

interface RenderStageEnv {
  ctx: RenderContext;
  url: string;
  timing: StageTiming;
  workerCount: number;
}

interface FrameLoopState {
  cursor: number;
  capturesDone: number;
  failed: boolean;
}

interface WorkerRun {
  active: Browser;
  url: string;
  width: number;
  height: number;
  frames: number;
  frameStart: number;
  capture: CaptureFormat;
  signal: AbortSignal | undefined;
  log: (msg: string) => void;
  onCapture: ((progress: CaptureProgress) => void) | undefined;
  stream: OrderedFrameStream;
  timing: StageTiming;
}

async function captureFrame(
  run: WorkerRun,
  loop: FrameLoopState,
  page: Page,
  idx: number,
): Promise<void> {
  const evalStart = Date.now();
  await page.evaluate(
    (frame: number) =>
      (globalThis as unknown as { __setFrame: (n: number) => Promise<void> }).__setFrame(frame),
    run.frameStart + idx,
  );
  run.timing.evalMs += Date.now() - evalStart;

  const captureStart = Date.now();
  const buf = await page.screenshot(screenshotOptions(run.capture));
  run.timing.captureMs += Date.now() - captureStart;

  const done = ++loop.capturesDone;

  const emitStart = Date.now();
  await run.stream.submit(idx, buf);
  run.timing.emitMs += Date.now() - emitStart;

  if (done % 100 === 0 || done === run.frames) {
    run.log(`frames: ${done}/${run.frames} captured`);
    run.onCapture?.({ done, total: run.frames });
  }
}

async function workerLoop(
  run: WorkerRun,
  loop: FrameLoopState,
  workerId: number,
): Promise<void> {
  const page = await run.active.newPage({
    viewport: { width: run.width, height: run.height },
    deviceScaleFactor: 1,
  });
  try {
    await page.goto(run.url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT_MS });
    await page.waitForFunction('window.__READY === true', null, { timeout: PAGE_LOAD_TIMEOUT_MS });
    for (;;) {
      if (loop.failed) return;
      if (run.signal?.aborted) throw new Error('render canceled');
      const idx = loop.cursor++;
      if (idx >= run.frames) break;
      await captureFrame(run, loop, page, idx);
    }
  } finally {
    await page.close().catch(() => {});
  }
  run.log(`worker ${workerId} done`);
}

async function runWorkers(run: WorkerRun, workerCount: number): Promise<void> {
  const loop: FrameLoopState = { cursor: 0, capturesDone: 0, failed: false };

  const settled = await Promise.allSettled(
    Array.from({ length: workerCount }, (_, i) =>
      workerLoop(run, loop, i + 1).catch((e) => {
        loop.failed = true;
        throw e;
      }),
    ),
  );
  const rejected = settled.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  if (rejected) throw rejected.reason;
}

async function finishEncode(
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

function formatProfile(profile: RenderProfile, workerCount: number): string {
  return (
    `profile: eval=${(profile.evalMs / 1000).toFixed(1)}s capture=${(profile.captureMs / 1000).toFixed(1)}s ` +
    `encode-backpressure=${(profile.emitMs / 1000).toFixed(1)}s (summed over ${workerCount} workers)`
  );
}

async function captureAndEncode(active: Browser, env: RenderStageEnv): Promise<void> {
  const { ctx, url, timing, workerCount } = env;
  const {
    fpsStr, codec, quality, preset, outPath, signal,
    width, height, frames, frameStart, capture, log, onCapture, tools,
  } = ctx;
  const encoder = spawnEncoder(tools.ffmpeg, fpsStr, { codec, quality, preset }, outPath);
  const killOnAbort = (): void => encoder.kill();
  signal?.addEventListener('abort', killOnAbort, { once: true });
  const stream = new OrderedFrameStream(encoder);
  try {
    await runWorkers(
      {
        active,
        url,
        width,
        height,
        frames,
        frameStart,
        capture,
        signal,
        log,
        onCapture,
        stream,
        timing,
      },
      workerCount,
    );
    await finishEncode(encoder, stream, log, outPath);
  } catch (e) {
    encoder.kill();
    throw e;
  } finally {
    signal?.removeEventListener('abort', killOnAbort);
  }
}

function reportProfile(env: RenderStageEnv): { profile: RenderProfile } {
  const { ctx, timing, workerCount } = env;
  const profile: RenderProfile = {
    evalMs: Math.round(timing.evalMs),
    captureMs: Math.round(timing.captureMs),
    emitMs: Math.round(timing.emitMs),
  };
  ctx.log(formatProfile(profile, workerCount));
  return { profile };
}

export async function renderVideo(
  opts: RenderJobOptions,
): Promise<{ profile: RenderProfile }> {
  const {
    html, style, tileCache, width, height, frames, fpsStr,
    workers, outPath, log = () => {}, browserPath = null,
    tools,
    capture = 'jpeg', codec = 'h264', quality = 'high', preset = 'medium',
    frameStart = 0, signal,
    onCapture,
  } = opts;

  const workerCount = Math.max(1, Math.min(workers, frames));
  const ctx: RenderContext = {
    width,
    height,
    frames,
    frameStart,
    fpsStr,
    outPath,
    capture,
    codec,
    quality,
    preset,
    signal,
    log,
    onCapture,
    tools,
  };
  if (signal?.aborted) throw new Error('render canceled');
  const timing: StageTiming = { evalMs: 0, captureMs: 0, emitMs: 0 };
  const { server, url } = await startServer({ html, style, tileCache });
  const env: RenderStageEnv = { ctx, url, timing, workerCount };

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(log, browserPath);
    await captureAndEncode(browser, env);
  } finally {
    await browser?.close().catch(() => {});
    server.close();
  }

  return reportProfile(env);
}
