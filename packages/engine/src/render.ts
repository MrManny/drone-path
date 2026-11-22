import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Writable } from 'node:stream';

import type { Browser, Page } from 'playwright-core';

import { MIME } from './assets.js';
import { ERR_RENDER_CANCELED, codedError, errorMessage } from 'drone-path-core/errors';
import { RENDERER_DIR, serveAsset } from './serve.js';
import type { CaptureFormat, Codec, EncodeSettings, Quality, MapStyle, RenderConfig } from './config.js';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { LogFn } from './logging.js';

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
  log,
}: {
  html: string;
  style: MapStyle;
  tileCache: string;
  log?: LogFn;
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
  return new Promise((resolve, reject) => {
    const onListenError = (err: Error): void => {
      reject(new Error(`local render server error: ${err.message}`, { cause: err }));
    };
    server.once('error', onListenError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onListenError);
      server.on('error', (err: Error) => {
        log?.(`render server error: ${err.message}`);
      });
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
  spawnError(): Error | null;
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
  ], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });

  let stderr = '';
  ffmpegProcess.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });

  // ffmpeg's process and stdin must never surface unhandled 'error' events (ENOENT on spawn, EPIPE on early exit); waiters must wake when the encoder dies.
  let procError: Error | null = null;
  const closed = new Promise<number | null>((resolve) => {
    ffmpegProcess.once('close', (code) => resolve(code));
    ffmpegProcess.once('error', (e: Error) => {
      procError = e;
      resolve(null);
    });
  });
  ffmpegProcess.on('error', () => {});
  const stopped = new Promise<string>((resolve) => {
    ffmpegProcess.stdin.on('error', (e: Error) => resolve(`ffmpeg stdin error: ${e.message}`));
    void closed.then((code) =>
      resolve(
        procError
          ? `ffmpeg process error: ${procError.message}`
          : `ffmpeg exited with code ${code}`,
      ),
    );
  });

  return {
    stdin: ffmpegProcess.stdin,
    stopped,
    closed,
    stderrText: () => stderr,
    spawnError: () => procError,
    kill: () => ffmpegProcess.kill(),
  };
}

export class OrderedFrameStream {
  private readonly pending = new Map<number, Buffer>();
  private nextIndex = 0;
  private flushing: Promise<void> | null = null;
  private waiters: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  private abortedError: unknown = null;
  private abortReject: ((err: unknown) => void) | null = null;
  private readonly abortPromise: Promise<never>;

  constructor(
    private readonly encoder: Pick<Encoder, 'stdin' | 'stopped' | 'stderrText'>,
    private readonly maxPending: number = 1,
  ) {
    this.abortPromise = new Promise<never>((_resolve, reject) => {
      this.abortReject = reject;
    });
    this.abortPromise.catch(() => {});
  }

  async submit(index: number, frame: Buffer): Promise<void> {
    if (this.abortedError !== null) throw this.abortedError;
    this.pending.set(index, frame);
    if (this.flushing) {
      await this.flushing;
    } else if (this.pending.has(this.nextIndex)) {
      await this.flushReady();
    }
    if (this.abortedError !== null) throw this.abortedError;
    while (this.pending.size >= this.maxPending || this.flushing !== null) {
      if (this.pending.has(this.nextIndex) && this.flushing === null) {
        await this.flushReady();
      } else if (this.flushing !== null) {
        await this.flushing;
      } else {
        await this.waitForSpace();
      }
      if (this.abortedError !== null) throw this.abortedError;
    }
  }

  flushReady(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.abortedError !== null) return Promise.reject(this.abortedError);
    const run = this.drainReady().finally(() => {
      if (this.flushing === run) this.flushing = null;
      this.wakeWaiters();
    });
    this.flushing = run;
    return run;
  }

  abort(err: unknown): void {
    if (this.abortedError !== null) return;
    this.abortedError = err;
    this.pending.clear();
    this.abortReject?.(err);
    this.rejectWaiters(err);
  }

  end(): void {
    this.encoder.stdin.end();
  }

  private async drainReady(): Promise<void> {
    try {
      while (this.pending.has(this.nextIndex)) {
        if (this.abortedError !== null) throw this.abortedError;
        const frame = this.pending.get(this.nextIndex) as Buffer;
        this.pending.delete(this.nextIndex);
        if (!this.encoder.stdin.write(frame)) {
          const raceAc = new AbortController();
          try {
            const woke = await Promise.race([
              once(this.encoder.stdin, 'drain', { signal: raceAc.signal }).then(
                () => 'drain' as const,
              ),
              this.encoder.stopped,
              this.abortPromise,
            ]);
            if (woke !== 'drain') {
              const stderr = this.encoder.stderrText().trim();
              throw new Error(`${woke}${stderr ? `: ${stderr}` : ''}`);
            }
          } finally {
            raceAc.abort();
          }
        }
        this.nextIndex++;
      }
    } catch (e) {
      if (this.abortedError === null) {
        this.abortedError = e;
        this.pending.clear();
        this.rejectWaiters(e);
      }
      throw e;
    }
  }

  private waitForSpace(): Promise<void> {
    if (this.abortedError !== null) return Promise.reject(this.abortedError);
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private wakeWaiters(): void {
    if (this.abortedError !== null || this.flushing !== null || this.pending.size >= this.maxPending) {
      return;
    }
    const queued = this.waiters;
    this.waiters = [];
    for (const w of queued) w.resolve();
  }

  private rejectWaiters(err: unknown): void {
    const queued = this.waiters;
    this.waiters = [];
    for (const w of queued) w.reject(err);
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

export interface RenderJobOptions
  extends Pick<
    RenderConfig,
    | 'style'
    | 'tileCache'
    | 'width'
    | 'height'
    | 'workers'
    | 'capture'
    | 'codec'
    | 'quality'
    | 'preset'
  > {
  html: string;
  frames: number;
  frameStart?: number;
  fpsStr: string;
  outPath: string;
  log?: LogFn;
  browserPath?: string | null;
  tools: FfmpegToolPaths;
  signal?: AbortSignal;
  onCapture?: (progress: CaptureProgress) => void;
}

interface RenderProfile {
  evalMs: number;
  captureMs: number;
  emitMs: number;
}

interface RenderContext
  extends Pick<
    RenderJobOptions,
    | 'width'
    | 'height'
    | 'frames'
    | 'fpsStr'
    | 'outPath'
    | 'capture'
    | 'codec'
    | 'quality'
    | 'preset'
    | 'tools'
  > {
  // The job's optional knobs, resolved to concrete values at entry: same
  // names and types, required here.
  frameStart: NonNullable<RenderJobOptions['frameStart']>;
  signal: RenderJobOptions['signal'];
  log: NonNullable<RenderJobOptions['log']>;
  onCapture: RenderJobOptions['onCapture'];
}

interface RenderStageEnv {
  ctx: RenderContext;
  url: string;
  timing: RenderProfile;
  workerCount: number;
}

interface FrameLoopState {
  cursor: number;
  capturesDone: number;
  failed: boolean;
}

interface WorkerRun extends RenderContext {
  active: Browser;
  url: string;
  stream: OrderedFrameStream;
  timing: RenderProfile;
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

function canceledError(cause?: unknown): Error {
  return codedError(ERR_RENDER_CANCELED, { code: 'RENDER_CANCELED', cause });
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
      if (run.signal?.aborted) throw canceledError();
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
        run.stream.abort(e);
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
  const procError = encoder.spawnError();
  if (procError) {
    throw new Error(`ffmpeg process error: ${procError.message}`, { cause: procError });
  }
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
  const { fpsStr, codec, quality, preset, outPath, signal, log, tools } = ctx;
  const encoder = spawnEncoder(tools.ffmpeg, fpsStr, { codec, quality, preset }, outPath);
  const stream = new OrderedFrameStream(encoder, workerCount);
  const abortEncode = (): void => {
    encoder.kill();
    stream.abort(canceledError());
  };
  signal?.addEventListener('abort', abortEncode, { once: true });
  try {
    await runWorkers({ ...ctx, active, url, stream, timing }, workerCount);
    if (signal?.aborted) throw canceledError();
    await finishEncode(encoder, stream, log, outPath);
  } catch (e) {
    encoder.kill();
    await encoder.closed;
    if (signal?.aborted) {
      throw e instanceof Error && e.message === ERR_RENDER_CANCELED
        ? e
        : canceledError(e);
    }
    throw e;
  } finally {
    signal?.removeEventListener('abort', abortEncode);
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
  if (signal?.aborted) throw canceledError();
  const timing: RenderProfile = { evalMs: 0, captureMs: 0, emitMs: 0 };
  const { server, url } = await startServer({ html, style, tileCache, log });
  const env: RenderStageEnv = { ctx, url, timing, workerCount };

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(log, browserPath);
    await captureAndEncode(browser, env);
  } finally {
    await browser?.close().catch(() => {});
    server.closeAllConnections?.();
    server.close();
  }

  return reportProfile(env);
}
