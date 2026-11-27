import { StringDecoder } from 'node:string_decoder';

import { runTool, spawnTool } from './exec-tool.js';
import { probeVideo } from './ffmpeg.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';
import { timeAt } from './frametime.js';

export const SHARPNESS_ANALYZER_METHOD = 'ffmpeg-blurdetect';
export const SHARPNESS_ANALYZER_VERSION = '1';
export const SHARPNESS_ANALYSIS_WIDTH = 640;
export const DEFAULT_MIN_EDGE_COVERAGE = 0.002;

export interface SharpnessAnalyzer {
  method: string;
  version: string;
}

export interface FrameSharpness {
  sharpnessScore: number | null;
  edgeCoverage: number;
  analyzer: SharpnessAnalyzer;
}

export interface RawSharpnessFrame {
  index: number;
  ptsTime: number | null;
  blurWidth: number | null;
  edgeCoverage: number;
}

export interface SharpnessFilterGraphOptions {
  analysisWidth?: number;
  stride?: number;
}

export interface AnalyzeFrameSharpnessOptions {
  analysisWidth?: number;
  minEdgeCoverage?: number;
  signal?: AbortSignal;
}

export type SharpnessAnalysisMode = 'sampled' | 'every-frame';

export interface ClipSharpnessSample {
  frameIndex: number;
  tSec: number;
  sharpnessScore: number | null;
  edgeCoverage: number;
}

export interface ClipSharpnessResult {
  analyzer: SharpnessAnalyzer;
  mode: SharpnessAnalysisMode;
  stride: number;
  analysisWidth: number;
  minEdgeCoverage: number;
  samples: ClipSharpnessSample[];
}

export interface AnalyzeClipSharpnessOptions {
  mode?: SharpnessAnalysisMode;
  fps?: number;
  analysisWidth?: number;
  minEdgeCoverage?: number;
  signal?: AbortSignal;
  onSample?: (sample: ClipSharpnessSample) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function parseFiniteOrNull(raw: string): number | null {
  const num = Number(raw.trim());
  return Number.isFinite(num) ? num : null;
}

/** Build the FFmpeg filtergraph that measures edge blur width and coverage on decoded luminance. */
export function buildSharpnessFilterGraph(options?: SharpnessFilterGraphOptions): string {
  const analysisWidth = options?.analysisWidth ?? SHARPNESS_ANALYSIS_WIDTH;
  if (!Number.isInteger(analysisWidth) || analysisWidth < 1) {
    throw new Error('sharpness analysis width must be a positive integer');
  }
  const stride = options?.stride;
  if (stride !== undefined && (!Number.isInteger(stride) || stride < 1)) {
    throw new Error('sharpness stride must be a positive integer');
  }

  const stages: string[] = [];
  if (stride !== undefined && stride > 1) {
    stages.push(`select='not(mod(n,${stride}))'`);
  }
  // Normalize to fixed luminance width before blurdetect/edgedetect so scores
  // are comparable across 1080p/4K sources and independent of JPEG encoding.
  stages.push(
    `scale=${analysisWidth}:-2:flags=area`,
    'format=gray',
    'blurdetect=high=0.117647:low=0.0588235:radius=50:planes=1',
    'edgedetect=low=0.0588235:high=0.117647:mode=wires',
    'signalstats',
    'metadata=mode=print:file=-',
  );
  return stages.join(',');
}

function createBlurdetectParser(onFrame: (frame: RawSharpnessFrame) => void) {
  let current: RawSharpnessFrame | null = null;

  const pushLine = (rawLine: string): void => {
    const line = rawLine.trim();
    if (line === '') return;

    const header = /^frame:(\d+)\s+pts:\S+\s+pts_time:(\S+)/u.exec(line);
    if (header) {
      if (current) onFrame(current);
      current = {
        index: Number(header[1]),
        ptsTime: parseFiniteOrNull(header[2]),
        blurWidth: null,
        edgeCoverage: 0,
      };
      return;
    }

    if (!current) return;

    if (line.startsWith('lavfi.blur=')) {
      current.blurWidth = parseFiniteOrNull(line.slice('lavfi.blur='.length));
    } else if (line.startsWith('lavfi.signalstats.YAVG=')) {
      const yavg = parseFiniteOrNull(line.slice('lavfi.signalstats.YAVG='.length));
      if (yavg !== null) {
        current.edgeCoverage = clamp(yavg / 255, 0, 1);
      }
    }
  };

  const flush = (): void => {
    if (current) {
      onFrame(current);
      current = null;
    }
  };

  return { pushLine, flush };
}

/** Parse per-frame blur width and edge coverage metadata emitted by FFmpeg metadata=mode=print. */
export function parseBlurdetectMetadata(output: string): RawSharpnessFrame[] {
  const frames: RawSharpnessFrame[] = [];
  const parser = createBlurdetectParser((frame) => frames.push(frame));
  for (const rawLine of output.split(/\r?\n/u)) {
    parser.pushLine(rawLine);
  }
  parser.flush();
  return frames;
}

/** Convert raw blur width and edge coverage into a monotonic higher-is-sharper score. */
export function scoreSharpnessSample(
  blurWidth: number | null,
  edgeCoverage: number,
  minEdgeCoverage = DEFAULT_MIN_EDGE_COVERAGE,
): FrameSharpness {
  const normalizedCoverage = Number.isFinite(edgeCoverage) ? clamp(edgeCoverage, 0, 1) : 0;
  const roundedCoverage = roundTo(normalizedCoverage, 6);
  const analyzer: SharpnessAnalyzer = {
    method: SHARPNESS_ANALYZER_METHOD,
    version: SHARPNESS_ANALYZER_VERSION,
  };

  if (
    blurWidth === null ||
    !Number.isFinite(blurWidth) ||
    blurWidth <= 0 ||
    normalizedCoverage < minEdgeCoverage
  ) {
    return {
      sharpnessScore: null,
      edgeCoverage: roundedCoverage,
      analyzer,
    };
  }

  return {
    sharpnessScore: roundTo(100 / (1 + blurWidth / 4), 2),
    edgeCoverage: roundedCoverage,
    analyzer,
  };
}

/** Analyze sharpness of a single decoded video frame at the given timestamp. */
export async function analyzeFrameSharpness(
  tools: FfmpegToolPaths,
  videoPath: string,
  tSec: number,
  options?: AnalyzeFrameSharpnessOptions,
): Promise<FrameSharpness> {
  if (!Number.isFinite(tSec) || tSec < 0) {
    throw new Error(`invalid sharpness timestamp: ${tSec}`);
  }
  const filterGraph = buildSharpnessFilterGraph({ analysisWidth: options?.analysisWidth });
  options?.signal?.throwIfAborted();

  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await runTool(
      tools.ffmpeg,
      [
        '-v', 'error',
        '-ss', tSec.toFixed(6),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', filterGraph,
        '-f', 'null',
        '-',
      ],
      { signal: options?.signal },
    ));
  } catch (e) {
    if (options?.signal?.aborted) throw e;
    throw new Error(`ffmpeg failed while analyzing frame sharpness at ${tSec.toFixed(3)}s`, {
      cause: e,
    });
  }

  const parsedStdout = parseBlurdetectMetadata(stdout);
  const frames = parsedStdout.length > 0 ? parsedStdout : parseBlurdetectMetadata(stderr);
  if (frames.length === 0) {
    throw new Error(`ffmpeg blurdetect produced no frame metadata at ${tSec.toFixed(3)}s`);
  }

  return scoreSharpnessSample(
    frames[0].blurWidth,
    frames[0].edgeCoverage,
    options?.minEdgeCoverage,
  );
}

/** Stream clip-wide sharpness samples from FFmpeg using sampled (1/sec) or every-frame mode. */
export async function analyzeClipSharpness(
  tools: FfmpegToolPaths,
  videoPath: string,
  options?: AnalyzeClipSharpnessOptions,
): Promise<ClipSharpnessResult> {
  const mode: SharpnessAnalysisMode = options?.mode ?? 'sampled';
  if (mode !== 'sampled' && mode !== 'every-frame') {
    throw new Error(`invalid sharpness analysis mode: ${String(mode)}`);
  }
  const analysisWidth = options?.analysisWidth ?? SHARPNESS_ANALYSIS_WIDTH;
  const minEdgeCoverage = options?.minEdgeCoverage ?? DEFAULT_MIN_EDGE_COVERAGE;
  if (!Number.isFinite(minEdgeCoverage) || minEdgeCoverage < 0 || minEdgeCoverage > 1) {
    throw new Error(`invalid sharpness min-edge-coverage: ${minEdgeCoverage}`);
  }
  let fps = options?.fps;
  if (fps !== undefined && (!Number.isFinite(fps) || fps <= 0)) {
    throw new Error(`invalid clip fps: ${fps}`);
  }

  options?.signal?.throwIfAborted();
  if (mode === 'sampled' && fps === undefined) {
    const probe = await probeVideo(tools, videoPath, undefined, options?.signal);
    fps = probe.fps.value;
    options?.signal?.throwIfAborted();
  }

  const stride = mode === 'every-frame' ? 1 : Math.max(1, Math.round(fps!));
  const filterGraph = buildSharpnessFilterGraph({ analysisWidth, stride });

  const samples: ClipSharpnessSample[] = [];
  const toSample = (raw: RawSharpnessFrame): ClipSharpnessSample => {
    const frameIndex = raw.index * stride;
    const tSec = raw.ptsTime ?? (fps !== undefined && fps > 0 ? timeAt(frameIndex, fps) : 0);
    const scored = scoreSharpnessSample(raw.blurWidth, raw.edgeCoverage, minEdgeCoverage);
    return {
      frameIndex,
      tSec,
      sharpnessScore: scored.sharpnessScore,
      edgeCoverage: scored.edgeCoverage,
    };
  };

  const emitFrame = (raw: RawSharpnessFrame): void => {
    const sample = toSample(raw);
    samples.push(sample);
    options?.onSample?.(sample);
  };

  const stderrText = await new Promise<string>((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(options.signal.reason ?? new Error('clip sharpness analysis canceled'));
      return;
    }

    const child = spawnTool(
      tools.ffmpeg,
      [
        '-v', 'error',
        '-i', videoPath,
        '-vf', filterGraph,
        '-f', 'null',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );

    const parser = createBlurdetectParser(emitFrame);
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;
    let terminating = false;
    let pendingError: unknown;

    const cleanup = (): void => {
      options?.signal?.removeEventListener('abort', onAbort);
    };

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const stopChild = (reason: unknown): void => {
      if (settled || terminating) return;
      terminating = true;
      pendingError = reason;
      child.kill();
    };

    const onAbort = (): void => {
      stopChild(options?.signal?.reason ?? new Error('clip sharpness analysis canceled'));
    };

    options?.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (settled || terminating) return;
      stdoutBuffer += typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk);
      try {
        let newlineIdx = stdoutBuffer.indexOf('\n');
        while (newlineIdx !== -1) {
          const line = stdoutBuffer.slice(0, newlineIdx);
          stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
          parser.pushLine(line);
          newlineIdx = stdoutBuffer.indexOf('\n');
        }
      } catch (err) {
        stopChild(err);
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (settled || terminating) return;
      stderrBuffer += typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk);
    });

    child.once('error', (err: Error) => {
      if (terminating) {
        fail(pendingError);
        return;
      }
      fail(new Error('ffmpeg failed while analyzing clip sharpness', { cause: err }));
    });

    child.once('close', (code: number | null) => {
      if (settled) return;
      if (terminating) {
        fail(pendingError);
        return;
      }
      stdoutBuffer += stdoutDecoder.end();
      stderrBuffer += stderrDecoder.end();
      try {
        if (stdoutBuffer.length > 0) {
          for (const line of stdoutBuffer.split(/\r?\n/u)) {
            parser.pushLine(line);
          }
        }
        parser.flush();
      } catch (err) {
        fail(err);
        return;
      }

      if (code !== 0) {
        const detail = stderrBuffer.trim();
        const suffix = detail ? `: ${detail}` : '';
        fail(new Error(`ffmpeg failed while analyzing clip sharpness (exit code ${code ?? 'null'})${suffix}`));
        return;
      }
      settled = true;
      cleanup();
      resolve(stderrBuffer);
    });
  });

  if (samples.length === 0) {
    for (const raw of parseBlurdetectMetadata(stderrText)) {
      emitFrame(raw);
    }
  }
  if (samples.length === 0) {
    throw new Error('ffmpeg blurdetect produced no frame metadata');
  }

  return {
    analyzer: {
      method: SHARPNESS_ANALYZER_METHOD,
      version: SHARPNESS_ANALYZER_VERSION,
    },
    mode,
    stride,
    analysisWidth,
    minEdgeCoverage,
    samples,
  };
}
