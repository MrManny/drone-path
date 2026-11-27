import fs from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { probeVideo } from 'drone-path-core/ffmpeg';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import {
  DEFAULT_MIN_EDGE_COVERAGE,
  SHARPNESS_ANALYSIS_WIDTH,
  SHARPNESS_ANALYZER_METHOD,
  SHARPNESS_ANALYZER_VERSION,
  analyzeClipSharpness,
} from 'drone-path-core/sharpness';
import type { ClipSharpnessSample, SharpnessAnalysisMode } from 'drone-path-core/sharpness';
import { createSrtSidecarLookup } from 'drone-path-core/srt-sidecar';

import type { ArchiveAvailability, ArchiveClip } from './query.js';
import { decimateSegments, sampleSegments } from './scan-track.js';
import { scanRecording } from './scanner.js';
import { CLIP_FINGERPRINT_VERSION, withArchiveStore } from './store.js';
import type { ArchiveStore, ClipUpdate, IndexedClip, SharpnessRunRecord } from './store.js';

export const DEFAULT_SHARPNESS_QUERY_LIMIT = 200;
export const MAX_SHARPNESS_QUERY_LIMIT = 2000;

export interface SharpnessSettings {
  mode: SharpnessAnalysisMode;
  stride: number;
  analysisWidth: number;
  minEdgeCoverage: number;
}

export interface ArchiveSharpnessRun {
  runId: number;
  clipKey: string;
  fingerprintKey: string;
  method: string;
  version: string;
  settings: SharpnessSettings;
  sampleCount: number;
  analyzedAtMs: number;
}

export interface AnalyzeArchiveSharpnessOptions {
  mode?: SharpnessAnalysisMode;
  analysisWidth?: number;
  minEdgeCoverage?: number;
  force?: boolean;
  signal?: AbortSignal;
  getTools: () => Promise<FfmpegToolPaths>;
  assertAllowedPath?: (filePath: string) => void;
  onSample?: (sample: ClipSharpnessSample) => void;
}

export interface AnalyzeArchiveSharpnessResult {
  clip: ArchiveClip;
  clipKey: string;
  cached: boolean;
  run: ArchiveSharpnessRun;
}

export interface GetArchiveSharpnessOptions {
  mode?: SharpnessAnalysisMode;
  runId?: number;
  startSec?: number;
  endSec?: number;
  limit?: number;
  offset?: number;
}

export interface ArchiveSharpnessTimeline {
  clipPath: string;
  clipKey: string;
  availability: ArchiveAvailability;
  analyzed: boolean;
  run: ArchiveSharpnessRun | null;
  totalSamples: number;
  limit: number;
  offset: number;
  truncated: boolean;
  samples: ClipSharpnessSample[];
}

export interface ExportArchiveSharpnessNdjsonOptions {
  mode?: SharpnessAnalysisMode;
  runId?: number;
  startSec?: number;
  endSec?: number;
  outPath?: string;
  overwrite?: boolean;
}

export interface ExportArchiveSharpnessNdjsonResult {
  clipPath: string;
  clipKey: string;
  availability: ArchiveAvailability;
  run: ArchiveSharpnessRun;
  count: number;
  ndjson: string;
}

export function archiveClipKey(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

export function sharpnessFingerprintKey(size: number, mtimeMs: number): string {
  return JSON.stringify({ size, mtimeMs });
}

export function serializeSharpnessSettings(settings: SharpnessSettings): string {
  return JSON.stringify({
    mode: settings.mode,
    stride: settings.stride,
    analysisWidth: settings.analysisWidth,
    minEdgeCoverage: settings.minEdgeCoverage,
  });
}

function decodeArchiveRun(row: SharpnessRunRecord): ArchiveSharpnessRun {
  return {
    runId: row.runId,
    clipKey: row.clipKey,
    fingerprintKey: row.fingerprintKey,
    method: row.method,
    version: row.version,
    settings: JSON.parse(row.settingsJson) as SharpnessSettings,
    sampleCount: row.sampleCount,
    analyzedAtMs: row.analyzedAtMs,
  };
}

function validateMode(mode: SharpnessAnalysisMode | undefined): SharpnessAnalysisMode {
  const resolved = mode ?? 'sampled';
  if (resolved !== 'sampled' && resolved !== 'every-frame') {
    throw new Error(`invalid sharpness analysis mode: ${String(resolved)}`);
  }
  return resolved;
}

function validateTimeRange(startSec: number | undefined, endSec: number | undefined): void {
  if (startSec !== undefined && (!Number.isFinite(startSec) || startSec < 0)) {
    throw new Error('expected a non-negative finite startSec');
  }
  if (endSec !== undefined && (!Number.isFinite(endSec) || endSec < 0)) {
    throw new Error('expected a non-negative finite endSec');
  }
  if (startSec !== undefined && endSec !== undefined && startSec > endSec) {
    throw new Error('expected startSec at or before endSec');
  }
}

function validatePaging(limit: number | undefined, offset: number | undefined): { limit: number; offset: number } {
  const resolvedLimit = limit ?? DEFAULT_SHARPNESS_QUERY_LIMIT;
  if (!Number.isInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > MAX_SHARPNESS_QUERY_LIMIT) {
    throw new Error(`expected limit to be an integer between 1 and ${MAX_SHARPNESS_QUERY_LIMIT}`);
  }
  const resolvedOffset = offset ?? 0;
  if (!Number.isInteger(resolvedOffset) || resolvedOffset < 0) {
    throw new Error('expected offset to be a non-negative integer');
  }
  return { limit: resolvedLimit, offset: resolvedOffset };
}

function resolveClipInStore(store: ArchiveStore, videoPath: string): IndexedClip | null {
  const candidates: string[] = [];
  const addCandidate = (candidatePath: string) => {
    const key = archiveClipKey(candidatePath);
    if (!candidates.includes(key)) candidates.push(key);
  };

  try {
    if (fs.existsSync(videoPath)) {
      addCandidate(fs.realpathSync(videoPath));
    }
  } catch {
    // Fall through to directory / lexical candidates when offline or inaccessible.
  }
  try {
    const dir = path.dirname(videoPath);
    if (fs.existsSync(dir)) {
      addCandidate(path.join(fs.realpathSync(dir), path.basename(videoPath)));
    }
  } catch {
    // Fall through to lexical candidates.
  }
  addCandidate(path.resolve(videoPath));
  addCandidate(videoPath);

  for (const key of candidates) {
    const clip = store.getClipByKey(key);
    if (clip) return clip;
  }
  return null;
}

function resolveRunForClip(
  store: ArchiveStore,
  clip: IndexedClip,
  options?: { mode?: SharpnessAnalysisMode; runId?: number },
): SharpnessRunRecord | null {
  if (options?.runId !== undefined) {
    if (!Number.isInteger(options.runId) || options.runId < 1) {
      throw new Error('expected a positive integer runId');
    }
    const run = store.getSharpnessRun(options.runId);
    return run && run.clipKey === clip.key ? run : null;
  }
  const fingerprintKey = sharpnessFingerprintKey(clip.fingerprint.size, clip.fingerprint.mtimeMs);
  return store.latestSharpnessRun(clip.key, {
    fingerprintKey,
    ...(options?.mode ? { mode: options.mode } : {}),
  });
}

function assertNotProtectedTarget(
  output: string,
  protectedFiles: readonly string[],
  errorMessageText: string,
): void {
  const resolveCandidate = (file: string) => (fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file));
  const outResolved = resolveCandidate(output);
  for (const protectedFile of protectedFiles) {
    const protectedResolved = resolveCandidate(protectedFile);
    const same = process.platform === 'win32'
      ? outResolved.toLowerCase() === protectedResolved.toLowerCase()
      : outResolved === protectedResolved;
    if (same) {
      throw new Error(errorMessageText);
    }
    if (fs.existsSync(output) && fs.existsSync(protectedFile)) {
      const targetStat = fs.statSync(output, { bigint: true });
      const protectedStat = fs.statSync(protectedFile, { bigint: true });
      if (targetStat.dev === protectedStat.dev && targetStat.ino === protectedStat.ino) {
        throw new Error(errorMessageText);
      }
    }
  }
}

async function indexSingleClip(
  db: string,
  resolvedPath: string,
  key: string,
  expectedSize: number,
  expectedMtimeMs: number,
  tools: FfmpegToolPaths,
  signal?: AbortSignal,
  assertAllowedPath?: (filePath: string) => void,
): Promise<IndexedClip> {
  const { revision } = withArchiveStore(db, (store) => store.snapshot());
  const sidecarFor = createSrtSidecarLookup();
  const sidecar = await sidecarFor(resolvedPath);
  if (sidecar !== null) assertAllowedPath?.(sidecar);
  const srtStat = sidecar === null ? null : await stat(sidecar).catch(() => null);
  let overview: ClipUpdate['overview'] = [];
  let samples: ClipUpdate['samples'] = [];
  let gaze: ClipUpdate['gaze'];
  let segments: ClipUpdate['segments'];

  const record = await scanRecording(resolvedPath, {
    tools,
    signal,
    sidecarFor: () => sidecar,
    onGaze: (_file, g) => {
      gaze = g;
    },
    onSegments: (_file, s) => {
      segments = s;
    },
    onTrack: (_file, segs) => {
      overview = decimateSegments(segs, 60, 9);
      samples = sampleSegments(segs);
    },
  });
  if (record.status === 'error') {
    throw new Error(record.error ?? `failed to inspect video: ${resolvedPath}`);
  }

  const currentStat = await stat(resolvedPath);
  if (currentStat.size !== expectedSize || currentStat.mtimeMs !== expectedMtimeMs) {
    throw new Error(`recording changed during sharpness analysis, rerun: ${resolvedPath}`);
  }
  const currentSidecar = await sidecarFor(resolvedPath);
  if (currentSidecar !== sidecar) {
    throw new Error(`recording changed during sharpness analysis, rerun: ${resolvedPath}`);
  }
  const currentSrtStat = currentSidecar === null ? null : await stat(currentSidecar).catch(() => null);
  const priorSrtSize = srtStat?.isFile() ? srtStat.size : null;
  const priorSrtMtimeMs = srtStat?.isFile() ? srtStat.mtimeMs : null;
  const nextSrtSize = currentSrtStat?.isFile() ? currentSrtStat.size : null;
  const nextSrtMtimeMs = currentSrtStat?.isFile() ? currentSrtStat.mtimeMs : null;
  if (priorSrtSize !== nextSrtSize || priorSrtMtimeMs !== nextSrtMtimeMs) {
    throw new Error(`recording changed during sharpness analysis, rerun: ${resolvedPath}`);
  }

  const update: ClipUpdate = {
    key,
    availability: 'online',
    fingerprint: {
      size: expectedSize,
      mtimeMs: expectedMtimeMs,
      srtSize: priorSrtSize,
      srtMtimeMs: priorSrtMtimeMs,
      schemaVersion: CLIP_FINGERPRINT_VERSION,
    },
    record,
    overview,
    samples,
    gaze,
    segments,
  };

  withArchiveStore(db, (store) => {
    store.commit(revision, [update], [], [], []);
  });
  return update;
}

/** Run or reuse opt-in clip-wide sharpness analysis and atomically persist the result in SQLite. */
export async function analyzeArchiveSharpness(
  db: string,
  videoPath: string,
  options: AnalyzeArchiveSharpnessOptions,
): Promise<AnalyzeArchiveSharpnessResult> {
  const mode = validateMode(options.mode);
  const analysisWidth = options.analysisWidth ?? SHARPNESS_ANALYSIS_WIDTH;
  if (!Number.isInteger(analysisWidth) || analysisWidth < 1) {
    throw new Error('sharpness analysis width must be a positive integer');
  }
  const minEdgeCoverage = options.minEdgeCoverage ?? DEFAULT_MIN_EDGE_COVERAGE;
  if (!Number.isFinite(minEdgeCoverage) || minEdgeCoverage < 0 || minEdgeCoverage > 1) {
    throw new Error(`invalid sharpness min-edge-coverage: ${minEdgeCoverage}`);
  }
  options.signal?.throwIfAborted();

  let resolvedPath: string;
  let fileStat: fs.Stats;
  try {
    resolvedPath = await realpath(videoPath);
    fileStat = await stat(resolvedPath);
  } catch (error) {
    throw new Error(`video file is not accessible: ${videoPath}`, { cause: error });
  }
  if (!fileStat.isFile()) {
    throw new Error(`video path is not a regular file: ${videoPath}`);
  }

  const key = archiveClipKey(resolvedPath);
  const fingerprintKey = sharpnessFingerprintKey(fileStat.size, fileStat.mtimeMs);

  let indexed = withArchiveStore(db, (store) => store.getClipByKey(key));
  let tools: FfmpegToolPaths | undefined;

  if (
    !indexed ||
    indexed.record.status === 'error' ||
    indexed.fingerprint.size !== fileStat.size ||
    indexed.fingerprint.mtimeMs !== fileStat.mtimeMs
  ) {
    tools = await options.getTools();
    indexed = await indexSingleClip(
      db,
      resolvedPath,
      key,
      fileStat.size,
      fileStat.mtimeMs,
      tools,
      options.signal,
      options.assertAllowedPath,
    );
  }

  let fps = indexed.record.video?.fps.value;
  if (fps === undefined || !Number.isFinite(fps) || fps <= 0) {
    tools ??= await options.getTools();
    const probe = await probeVideo(tools, resolvedPath, undefined, options.signal);
    fps = probe.fps.value;
  }

  const stride = mode === 'every-frame' ? 1 : Math.max(1, Math.round(fps));
  const settings: SharpnessSettings = { mode, stride, analysisWidth, minEdgeCoverage };
  const settingsJson = serializeSharpnessSettings(settings);

  if (!options.force) {
    const cachedRun = withArchiveStore(db, (store) =>
      store.findSharpnessRun({
        clipKey: key,
        fingerprintKey,
        method: SHARPNESS_ANALYZER_METHOD,
        version: SHARPNESS_ANALYZER_VERSION,
        settingsJson,
      }),
    );
    if (cachedRun) {
      return {
        clip: { ...indexed.record, availability: indexed.availability },
        clipKey: key,
        cached: true,
        run: decodeArchiveRun(cachedRun),
      };
    }
  }

  tools ??= await options.getTools();
  const analyzed = await analyzeClipSharpness(tools, resolvedPath, {
    mode,
    fps,
    analysisWidth,
    minEdgeCoverage,
    signal: options.signal,
    onSample: options.onSample,
  });

  const postStat = await stat(resolvedPath).catch((error) => {
    throw new Error(`video file is not accessible: ${videoPath}`, { cause: error });
  });
  if (!postStat.isFile() || postStat.size !== fileStat.size || postStat.mtimeMs !== fileStat.mtimeMs) {
    throw new Error(`recording changed during sharpness analysis, rerun: ${resolvedPath}`);
  }

  const saved = withArchiveStore(db, (store) =>
    store.saveSharpnessRun({
      clipKey: key,
      fingerprintKey,
      expectedFingerprint: { size: fileStat.size, mtimeMs: fileStat.mtimeMs },
      method: analyzed.analyzer.method,
      version: analyzed.analyzer.version,
      settingsJson,
      samples: analyzed.samples,
    }),
  );

  return {
    clip: { ...indexed.record, availability: indexed.availability },
    clipKey: key,
    cached: false,
    run: decodeArchiveRun(saved),
  };
}

/** Query stored sharpness samples offline with time-range filtering and bounded pagination. */
export function getArchiveSharpness(
  db: string,
  videoPath: string,
  options: GetArchiveSharpnessOptions = {},
): ArchiveSharpnessTimeline {
  if (options.mode !== undefined) validateMode(options.mode);
  validateTimeRange(options.startSec, options.endSec);
  const { limit, offset } = validatePaging(options.limit, options.offset);

  return withArchiveStore(db, (store) => {
    const clip = resolveClipInStore(store, videoPath);
    if (!clip) {
      throw new Error(`clip is not indexed in archive: ${videoPath}`);
    }
    const run = resolveRunForClip(store, clip, {
      mode: options.mode,
      runId: options.runId,
    });
    if (!run) {
      return {
        clipPath: clip.record.path,
        clipKey: clip.key,
        availability: clip.availability,
        analyzed: false,
        run: null,
        totalSamples: 0,
        limit,
        offset,
        truncated: false,
        samples: [],
      };
    }

    const totalSamples = store.countSharpnessSamples(run.runId, {
      startSec: options.startSec,
      endSec: options.endSec,
    });
    const samples = store.readSharpnessSamples(run.runId, {
      startSec: options.startSec,
      endSec: options.endSec,
      limit,
      offset,
    });

    return {
      clipPath: clip.record.path,
      clipKey: clip.key,
      availability: clip.availability,
      analyzed: true,
      run: decodeArchiveRun(run),
      totalSamples,
      limit,
      offset,
      truncated: offset + samples.length < totalSamples,
      samples,
    };
  });
}

/** Export the full matching sharpness timeline as NDJSON, optionally writing to a file. */
export function exportArchiveSharpnessNdjson(
  db: string,
  videoPath: string,
  options: ExportArchiveSharpnessNdjsonOptions = {},
): ExportArchiveSharpnessNdjsonResult {
  if (options.mode !== undefined) validateMode(options.mode);
  validateTimeRange(options.startSec, options.endSec);

  const result = withArchiveStore(db, (store) => {
    const clip = resolveClipInStore(store, videoPath);
    if (!clip) {
      throw new Error(`clip is not indexed in archive: ${videoPath}`);
    }
    const run = resolveRunForClip(store, clip, {
      mode: options.mode,
      runId: options.runId,
    });
    if (!run) {
      throw new Error(`no sharpness analysis found for clip: ${clip.record.path}`);
    }
    const samples = store.readSharpnessSamples(run.runId, {
      startSec: options.startSec,
      endSec: options.endSec,
    });
    const ndjson = samples.length > 0
      ? samples.map((sample) => JSON.stringify(sample)).join('\n') + '\n'
      : '';
    return {
      clipPath: clip.record.path,
      clipKey: clip.key,
      availability: clip.availability,
      run: decodeArchiveRun(run),
      count: samples.length,
      ndjson,
    };
  });

  if (options.outPath !== undefined) {
    assertNotProtectedTarget(
      options.outPath,
      [db, `${db}-wal`, `${db}-shm`, `${db}-journal`],
      'export file cannot overwrite the archive database',
    );
    assertNotProtectedTarget(
      options.outPath,
      [result.clipPath, videoPath],
      'export file cannot overwrite the source recording',
    );
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    try {
      fs.writeFileSync(options.outPath, result.ndjson, {
        encoding: 'utf8',
        flag: options.overwrite ? 'w' : 'wx',
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
        throw new Error(
          `refusing to overwrite existing sharpness export file: ${options.outPath}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  return result;
}
