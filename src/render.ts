import type { Browser, Page } from 'playwright-core';

import {
  finishEncode,
  formatProfile,
  JPEG_QUALITY,
  OrderedFrameStream,
  spawnEncoder,
} from './encode.js';
import type { RenderProfile } from './encode.js';
import { ERR_RENDER_CANCELED, errorMessage } from './errors.js';
import { startRenderServer } from './serve.js';
import type { CaptureFormat, RenderConfig } from './config.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';
import type { LogFn } from './logging.js';

const PAGE_LOAD_TIMEOUT_MS = 60000;
const SCREENSHOT_TIMEOUT_MS = 60000;

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

function screenshotOptions(capture: CaptureFormat) {
  return capture === 'jpeg'
    ? {
        type: 'jpeg' as const,
        quality: JPEG_QUALITY,
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

interface StageTiming {
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
  timing: StageTiming;
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
      if (run.signal?.aborted) throw new Error(ERR_RENDER_CANCELED);
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

async function captureAndEncode(active: Browser, env: RenderStageEnv): Promise<void> {
  const { ctx, url, timing, workerCount } = env;
  const { fpsStr, codec, quality, preset, outPath, signal, log, tools } = ctx;
  const encoder = spawnEncoder(tools.ffmpeg, fpsStr, { codec, quality, preset }, outPath);
  const killOnAbort = (): void => encoder.kill();
  signal?.addEventListener('abort', killOnAbort, { once: true });
  const stream = new OrderedFrameStream(encoder);
  try {
    await runWorkers({ ...ctx, active, url, stream, timing }, workerCount);
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
  if (signal?.aborted) throw new Error(ERR_RENDER_CANCELED);
  const timing: StageTiming = { evalMs: 0, captureMs: 0, emitMs: 0 };
  const { server, url } = await startRenderServer({ html, style, tileCache });
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
