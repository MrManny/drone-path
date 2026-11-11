import fs from 'node:fs';
import path from 'node:path';

import { errorMessage } from './errors.js';
import type { Bbox } from './geo.js';
import { outputMatchesSource, probeVideo, verifyOutput } from './ff.js';
import { resolveFfTools } from './fftools.js';
import type { FfToolPaths } from './fftools.js';
import type { VideoProbe } from './ff.js';
import type { GimbalDeviceConstants } from './cammeta.js';
import { videoBaseName } from './inputs.js';
import { pathKey, uniquePath } from './paths.js';
import { loadTelemetry } from './telemetry.js';
import type {
  FrameChannels,
  HeadingMode,
  Telemetry,
  TelemetryMethod,
  TelemetrySource,
} from './telemetry-math.js';
import { writeTelemetryDocument } from './telemetry-json.js';
import type { TelemetryDocumentInput, TelemetryFrameInput } from './telemetry-json.js';
import { prefetchTiles } from './tiles.js';
import type { PrefetchStats, WarmOptions } from './tiles.js';
import { planIntroOutroFrames, planView } from './plan.js';
import type { IntroOutroFrames, Overview } from './plan.js';
import { buildPageHtml, planPageOpts } from './page.js';
import type { PageOpts } from './page.js';
import { renderVideo } from './render.js';
import type { CaptureProgress } from './render.js';
import type { FrameRange, HudSpec, RenderConfig } from './config.js';
import {
  effectiveZoomOut,
  hasAltitude,
  resolveHudSpec,
  resolveRange,
} from './config.js';
import {
  fixesLabel,
  noLockCuesLabel,
  telemetrySummary,
  trackDistanceLabel,
} from './summary.js';
export type LogFn = (msg: string) => void;

const PREPARE_STAGE_ORDER = ['probe', 'telemetry', 'plan'] as const;

export type PrepareStage = (typeof PREPARE_STAGE_ORDER)[number];

export interface PrepareProgress {
  stage: PrepareStage;
  done: number;
  total: number;
}

export type PrepareProgressFn = (progress: PrepareProgress) => void;

export interface RecordingSummary {
  video: string;
  out: string;
  status: 'ok' | 'skipped' | 'error';
  width?: number;
  height?: number;
  style?: string;
  view?: string;
  introFrames?: number;
  outroFrames?: number;
  hud?: HudSpec;
  source?: TelemetrySource;
  method?: TelemetryMethod;
  headingMode?: HeadingMode;
  fixes?: number;
  noLock?: number;
  frames?: number;
  fps?: string;
  frameRange?: FrameRange;
  trackDistanceM?: number;
  bbox?: Bbox;
  zoom?: number;
  zoomFixed?: boolean;
  zoomOut?: number;
  tilesDownloaded?: number;
  verified?: boolean;
  elapsedSec: number;
  error?: string;
}

export interface BatchResult {
  ok: number;
  skipped: number;
  failed: number;
}

export function outputPathFor(videoPath: string, config: RenderConfig): string {
  const base = videoBaseName(videoPath);
  const name = `${base}${config.outSuffix}.mp4`;
  return config.outDir
    ? path.join(config.outDir, name)
    : path.join(path.dirname(videoPath), name);
}

export interface PlannedOutput {
  out: string;
  plain: string;
}

export function planOutputs(videos: string[], config: RenderConfig): PlannedOutput[] {
  const used = new Set<string>();
  return videos.map((video) => {
    const plain = outputPathFor(video, config);
    const key = pathKey(plain);
    if (!used.has(key)) {
      used.add(key);
      return { out: plain, plain };
    }
    const ext = path.extname(plain);
    const stem = path.basename(plain, ext);
    const out = uniquePath(path.dirname(plain), stem, ext, (candidate) =>
      used.has(pathKey(candidate)),
    );
    used.add(pathKey(out));
    return { out, plain };
  });
}

function resolveHud(config: RenderConfig, tel: Telemetry, log: LogFn): HudSpec {
  const hud = resolveHudSpec(config.hud, hasAltitude(tel.frames.map((f) => f.alt)));
  if (config.hud.alt && !hud.alt) {
    log('hud: altitude unavailable in this telemetry source (chip disabled)');
  }
  return hud;
}

export function frameArrays(tel: Telemetry): FrameChannels {
  const lat: number[] = [];
  const lon: number[] = [];
  tel.frames.forEach((frame, i) => {
    if (frame.fix === null) {
      throw new Error(`telemetry frame ${i} has no GPS position`);
    }
    lat.push(frame.fix.lat);
    lon.push(frame.fix.lon);
  });
  return {
    lat,
    lon,
    alt: tel.frames.map((f) => f.alt),
    speed: tel.frames.map((f) => f.speed),
    headingDeg: tel.frames.map((f) => f.headingDeg),
  };
}

function describeView(
  config: RenderConfig,
  overview: Overview,
  tilesLabel: string,
): string {
  const zoomNote = config.zoom
    ? ' (fixed)'
    : config.zoomOut
      ? ` (-${config.zoomOut})`
      : '';
  return (
    `view: ${config.view} at zoom ${overview.zoom}${zoomNote}, ` +
    `${overview.tiles.length} tiles (${tilesLabel})`
  );
}

function mtimeOf(outPath: string): number | null {
  return fs.existsSync(outPath) ? fs.statSync(outPath).mtimeMs : null;
}

function removePartialOutput(
  outPath: string,
  mtimeBefore: number | null,
  log: LogFn,
): void {
  const mtimeNow = mtimeOf(outPath);
  if (mtimeNow !== null && (mtimeBefore === null || mtimeNow !== mtimeBefore)) {
    fs.rmSync(outPath, { force: true });
    log(`removed partial output: ${outPath}`);
  }
}

async function renderWithOutputCleanup(
  outPath: string,
  log: LogFn,
  render: () => Promise<void>,
): Promise<void> {
  const mtimeBefore = mtimeOf(outPath);
  try {
    await render();
  } catch (e) {
    removePartialOutput(outPath, mtimeBefore, log);
    throw e;
  }
}

export type TileWarmFn = (options: WarmOptions) => Promise<PrefetchStats>;

export interface PipelineDeps {
  probeVideo: typeof probeVideo;
  loadTelemetry: typeof loadTelemetry;
  prefetchTiles: TileWarmFn;
  renderVideo: typeof renderVideo;
  verifyOutput: typeof verifyOutput;
  outputMatchesSource: typeof outputMatchesSource;
}

const realDeps: Omit<PipelineDeps, 'prefetchTiles'> = {
  probeVideo,
  loadTelemetry,
  renderVideo,
  verifyOutput,
  outputMatchesSource,
};

function resolveDeps(
  overrides: Partial<PipelineDeps> | undefined,
  tileCache: string,
): PipelineDeps {
  return {
    probeVideo: overrides?.probeVideo ?? realDeps.probeVideo,
    loadTelemetry: overrides?.loadTelemetry ?? realDeps.loadTelemetry,
    prefetchTiles:
      overrides?.prefetchTiles ??
      ((options) => prefetchTiles({ ...options, cacheDir: tileCache })),
    renderVideo: overrides?.renderVideo ?? realDeps.renderVideo,
    verifyOutput: overrides?.verifyOutput ?? realDeps.verifyOutput,
    outputMatchesSource: overrides?.outputMatchesSource ?? realDeps.outputMatchesSource,
  };
}

export interface PipelineOptions {
  deps?: Partial<PipelineDeps>;
  tools?: FfToolPaths;
  range?: FrameRange;
  signal?: AbortSignal;
  onProgress?: PrepareProgressFn;
  onCapture?: (progress: CaptureProgress) => void;
}

export interface PreparedRecording {
  width: number;
  height: number;
  probe: VideoProbe;
  tel: Telemetry;
  frameValues: TelemetryFrameInput[];
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
  hud: HudSpec;
  introOutro: IntroOutroFrames;
  overview: Overview;
  frames: FrameChannels;
}

type PrepareReporter = (stage: PrepareStage) => void;

function createPrepareReporter(
  onProgress: PrepareProgressFn = () => {},
): PrepareReporter {
  return (stage) =>
    onProgress({
      stage,
      done: PREPARE_STAGE_ORDER.indexOf(stage),
      total: PREPARE_STAGE_ORDER.length,
    });
}

interface PrepareStageEnv {
  videoPath: string;
  config: RenderConfig;
  log: LogFn;
  deps: PipelineDeps;
  tools: FfToolPaths;
  report: PrepareReporter;
}

async function probeStage(
  env: PrepareStageEnv,
): Promise<{ probe: VideoProbe; introOutro: IntroOutroFrames }> {
  const { videoPath, config, log, deps, tools, report } = env;
  report('probe');
  const probe = await deps.probeVideo(tools, videoPath, log);
  log(
    `source: ${path.basename(videoPath)}  ${probe.width}x${probe.height} @ ${probe.fps.str} fps, ${probe.frames} frames`,
  );
  const introOutro = planIntroOutroFrames(config, {
    fps: probe.fps.value,
    frames: probe.frames,
  });
  if (introOutro.clamped) {
    log(
      `intro/outro shortened to ${introOutro.introN}/${introOutro.outroN} frames for this clip`,
    );
  }
  return { probe, introOutro };
}

async function telemetryStage(
  env: PrepareStageEnv,
  probe: VideoProbe,
): Promise<{
  tel: Telemetry;
  frameValues: TelemetryFrameInput[];
  protoFile: string | null;
  gimbalDevice: GimbalDeviceConstants | null;
  hud: HudSpec;
}> {
  const { videoPath, config, log, deps, tools, report } = env;
  report('telemetry');
  const loaded = await deps.loadTelemetry(videoPath, {
    frames: probe.frames,
    fpsValue: probe.fps.value,
    durationSec: probe.durationSec,
    tools,
  });
  const tel = loaded.telemetry;
  const summary = telemetrySummary(tel);
  log(
    `telemetry: ${summary.source} (${summary.method}), ${fixesLabel(summary.fixes)}, ` +
      `heading=${summary.headingMode}, track ${trackDistanceLabel(summary.trackDistanceM)}` +
      (summary.noLock ? `, ${noLockCuesLabel(summary.noLock)}` : ''),
  );
  const hud = resolveHud(config, tel, log);
  return {
    tel,
    frameValues: loaded.frameValues,
    protoFile: loaded.protoFile,
    gimbalDevice: loaded.gimbalDevice,
    hud,
  };
}

async function viewPlanStage(env: PrepareStageEnv, tel: Telemetry): Promise<Overview> {
  const { config, log, report } = env;
  report('plan');
  const overview = planView(tel.bbox, config.width, config.height, config);
  log(describeView(config, overview, config.style));
  return overview;
}

async function tileWarmStage(
  deps: PipelineDeps,
  config: RenderConfig,
  overview: Overview,
  log: LogFn,
): Promise<PrefetchStats> {
  const tileStats = await deps.prefetchTiles({
    style: config.style,
    tiles: overview.tiles,
    log,
  });
  if (tileStats.downloaded) {
    log(`tiles: ${tileStats.downloaded} downloaded, ${tileStats.failed} placeholders`);
  }
  return tileStats;
}

export async function prepareSession(
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  options: PipelineOptions = {},
): Promise<PreparedRecording> {
  const env: PrepareStageEnv = {
    videoPath,
    config,
    log,
    deps: resolveDeps(options.deps, config.tileCache),
    tools: options.tools ?? resolveFfTools(config),
    report: createPrepareReporter(options.onProgress),
  };

  const { width, height } = config;

  const { probe, introOutro } = await probeStage(env);
  const { tel, frameValues, protoFile, gimbalDevice, hud } = await telemetryStage(
    env,
    probe,
  );
  const overview = await viewPlanStage(env, tel);
  const frames = frameArrays(tel);

  return {
    width,
    height,
    probe,
    tel,
    frameValues,
    protoFile,
    gimbalDevice,
    hud,
    introOutro,
    overview,
    frames,
  };
}

export function recordingPageOpts(
  prep: PreparedRecording,
  config: RenderConfig,
): PageOpts {
  return planPageOpts({
    bbox: prep.tel.bbox,
    width: prep.width,
    height: prep.height,
    config,
    source: { fps: prep.probe.fps.value, frames: prep.probe.frames },
    frames: prep.frames,
    planned: {
      overview: prep.overview,
      introOutro: prep.introOutro,
      hud: prep.hud,
    },
  });
}

interface RenderContext extends PreparedRecording {
  videoPath: string;
  outPath: string;
  config: RenderConfig;
  log: LogFn;
  outFrames: number;
  frameRange: FrameRange | null;
  tileStats: PrefetchStats;
}

interface RenderStageEnv {
  ctx: RenderContext;
  deps: PipelineDeps;
  tools: FfToolPaths;
  options: PipelineOptions;
}

function buildOkSummary(ctx: RenderContext, elapsedSec: number): RecordingSummary {
  const { config, probe, tel, hud, introOutro, overview, tileStats } = ctx;
  const telemetry = telemetrySummary(tel);
  return {
    video: ctx.videoPath,
    out: ctx.outPath,
    status: 'ok',
    width: ctx.width,
    height: ctx.height,
    style: config.style,
    view: config.view,
    introFrames: introOutro.introN,
    outroFrames: introOutro.outroN,
    hud,
    // Field by field, not a spread: a TelemetrySummary rename must land here visibly, not silently drop a --json key.
    source: telemetry.source,
    method: telemetry.method,
    headingMode: telemetry.headingMode,
    fixes: telemetry.fixes,
    noLock: telemetry.noLock,
    trackDistanceM: telemetry.trackDistanceM,
    frames: ctx.outFrames,
    fps: probe.fps.str,
    frameRange: ctx.frameRange ?? undefined,
    bbox: tel.bbox,
    zoom: overview.zoom,
    zoomFixed: config.zoom > 0,
    zoomOut: effectiveZoomOut(config),
    tilesDownloaded: tileStats.downloaded,
    verified: true,
    elapsedSec,
  };
}

async function verifyRenderedOutput(env: RenderStageEnv): Promise<void> {
  const { ctx, deps, tools } = env;
  const verify = await deps.verifyOutput(tools, ctx.outPath, ctx.outFrames, ctx.probe.fps.value);
  if (!verify.ok) {
    throw new Error(
      `output verification failed: got ${verify.frames} frames @ ${verify.fps ?? 'unknown'}, ` +
        `expected ${ctx.outFrames} @ ${ctx.probe.fps.str}`,
    );
  }
  ctx.log(
    ctx.frameRange
      ? 'verified: frame count and frame rate are 1:1 within the exported range'
      : 'verified: frame count and frame rate match the source',
  );
}

async function renderToOutput(env: RenderStageEnv): Promise<void> {
  const { ctx, deps, tools, options } = env;
  const html = buildPageHtml(recordingPageOpts(ctx, ctx.config));
  fs.mkdirSync(path.dirname(ctx.outPath), { recursive: true });
  await renderWithOutputCleanup(ctx.outPath, ctx.log, async () => {
    await deps.renderVideo({
      html,
      capture: ctx.config.capture,
      codec: ctx.config.codec,
      quality: ctx.config.quality,
      preset: ctx.config.preset,
      style: ctx.config.style,
      tileCache: ctx.config.tileCache,
      tools,
      width: ctx.width,
      height: ctx.height,
      frames: ctx.outFrames,
      frameStart: ctx.frameRange?.start ?? 0,
      fpsStr: ctx.probe.fps.str,
      workers: ctx.config.workers,
      outPath: ctx.outPath,
      browserPath: ctx.config.browser,
      signal: options.signal,
      log: ctx.log,
      onCapture: options.onCapture,
    });
    await verifyRenderedOutput(env);
  });
}

export function telemetryExportInput(prep: PreparedRecording): TelemetryDocumentInput {
  return {
    source: prep.tel.source,
    headingMode: prep.tel.headingMode,
    frameCount: prep.probe.frames,
    protoFile: prep.protoFile,
    gimbalDevice: prep.gimbalDevice,
    frames: prep.frameValues,
    headingDeg: prep.tel.frames.map((frame) => frame.headingDeg),
  };
}

function writeTelemetryExport(
  file: string,
  prep: PreparedRecording,
  log: LogFn,
): void {
  // The document intentionally covers the whole recording: a frame range
  // limits the render, never this export.
  writeTelemetryDocument(file, telemetryExportInput(prep));
  log(`telemetry JSON: wrote ${file}`);
}

export async function processRecording(
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  outPath: string = outputPathFor(videoPath, config),
  options: PipelineOptions = {},
): Promise<RecordingSummary> {
  const t0 = Date.now();
  const deps = resolveDeps(options.deps, config.tileCache);
  const tools = options.tools ?? resolveFfTools(config);
  if (options.signal?.aborted) throw new Error('render canceled');

  const prep = await prepareSession(videoPath, config, log, {
    ...options,
    deps,
    tools,
  });

  if (config.telemetryJson) {
    writeTelemetryExport(config.telemetryJson, prep, log);
  }

  const tileStats = await tileWarmStage(deps, config, prep.overview, log);
  const range = resolveRange(options.range, prep.probe.frames);
  const outFrames = range ? range.end - range.start + 1 : prep.probe.frames;
  const ctx: RenderContext = {
    ...prep,
    videoPath,
    outPath,
    config,
    log,
    outFrames,
    frameRange: range,
    tileStats,
  };
  await renderToOutput({ ctx, deps, tools, options });
  return buildOkSummary(ctx, Math.round((Date.now() - t0) / 1000));
}

export async function runBatch(
  videos: string[],
  config: RenderConfig,
  log: LogFn,
  emit: (summary: RecordingSummary) => void,
  options: PipelineOptions = {},
): Promise<BatchResult> {
  const result: BatchResult = { ok: 0, skipped: 0, failed: 0 };
  const deps = resolveDeps(options.deps, config.tileCache);
  const tools = options.tools ?? resolveFfTools(config);

  if (config.telemetryJson && videos.length > 1) {
    throw new Error('--telemetry-json writes one document per run: give a single recording');
  }

  const plans = planOutputs(videos, config);

  for (const [idx, video] of videos.entries()) {
    const base = path.basename(video);
    log(`=== ${base} ===`);

    const plan = plans[idx];
    if (plan.out !== plan.plain) {
      log(
        `warning: output name collision for ${base} - writing ${path.basename(plan.out)} instead`,
      );
    }
    if (config.skipExisting && (await deps.outputMatchesSource(tools, video, plan.out))) {
      log(`SKIP  ${plan.out}  (exists and matches the source)`);
      emit({ video, out: plan.out, status: 'skipped', elapsedSec: 0 });
      result.skipped++;
      continue;
    }

    try {
      const summary = await processRecording(video, config, log, plan.out, {
        ...options,
        deps,
        tools,
      });
      emit(summary);
      log(`OK  ${plan.out}  (${summary.frames} frames @ ${summary.fps}, ${summary.elapsedSec} s)`);
      result.ok++;
    } catch (e) {
      const message = errorMessage(e);
      log(`ERROR  ${base}: ${message}`);
      emit({
        video,
        out: plan.out,
        status: 'error',
        elapsedSec: 0,
        error: message,
      });
      result.failed++;
    }
  }

  return result;
}
