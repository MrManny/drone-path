import { runTool } from './exec-tool.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';

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

/** Parse per-frame blur width and edge coverage metadata emitted by FFmpeg metadata=mode=print. */
export function parseBlurdetectMetadata(output: string): RawSharpnessFrame[] {
  const frames: RawSharpnessFrame[] = [];
  let current: RawSharpnessFrame | null = null;

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const header = /^frame:(\d+)\s+pts:\S+\s+pts_time:(\S+)/u.exec(line);
    if (header) {
      if (current) frames.push(current);
      current = {
        index: Number(header[1]),
        ptsTime: parseFiniteOrNull(header[2]),
        blurWidth: null,
        edgeCoverage: 0,
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('lavfi.blur=')) {
      current.blurWidth = parseFiniteOrNull(line.slice('lavfi.blur='.length));
    } else if (line.startsWith('lavfi.signalstats.YAVG=')) {
      const yavg = parseFiniteOrNull(line.slice('lavfi.signalstats.YAVG='.length));
      if (yavg !== null) {
        current.edgeCoverage = clamp(yavg / 255, 0, 1);
      }
    }
  }

  if (current) frames.push(current);
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
