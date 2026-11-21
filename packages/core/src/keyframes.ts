import fs from 'node:fs';
import path from 'node:path';

import { runTool } from './exec-tool.js';
import { probeVideo } from './ffmpeg.js';
import type { VideoProbe } from './ffmpeg.js';
import type { FfmpegToolPaths } from './ffmpeg-tools.js';
import { timeAt } from './frametime.js';
import { loadTelemetrySamples } from './telemetry.js';
import type { SourceSamples } from './telemetry.js';
import { computeTelemetry } from './telemetry-math.js';
import type { Telemetry } from './telemetry-math.js';
import type { TrackRecord } from './track.js';

export type KeyframeRequest =
  | { kind: 'time'; tSec: number }
  | { kind: 'frame'; frame: number };

export interface TelemetrySnapshot {
  lat: number | null;
  lon: number | null;
  altRelM: number | null;
  altAbsM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  gimbalPitchDeg: number | null;
  gimbalYawDeg: number | null;
  iso: number | null;
  shutterTime: number | null;
}

export interface ExtractedKeyframe {
  path: string;
  tSec: number;
  frame: number;
  width: number;
  height: number;
  telemetry: TelemetrySnapshot | null;
}

export interface ExtractKeyframesOptions {
  at: readonly KeyframeRequest[];
  maxWidth?: number;
  outDir?: string;
  tools: FfmpegToolPaths;
  signal?: AbortSignal;
}

interface ResolvedTarget {
  tSec: number;
  frame: number;
}

function parseFrameToken(raw: string, token: string): KeyframeRequest {
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`invalid keyframe frame selector: ${token}`);
  }
  const frame = Number(raw);
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new Error(`invalid keyframe frame selector: ${token}`);
  }
  return { kind: 'frame', frame };
}

function parseTimeToken(token: string): KeyframeRequest {
  const raw = token.endsWith('s') || token.endsWith('S') ? token.slice(0, -1) : token;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(raw)) {
    throw new Error(`invalid keyframe timestamp: ${token}`);
  }
  const tSec = Number(raw);
  if (!Number.isFinite(tSec) || tSec < 0) {
    throw new Error(`keyframe timestamp must be non-negative: ${token}`);
  }
  return { kind: 'time', tSec };
}

export function parseKeyframeSpecs(spec: string): KeyframeRequest[] {
  if (typeof spec !== 'string' || spec.trim() === '') {
    throw new Error('keyframe spec must not be empty');
  }
  return spec.split(',').map((item) => {
    const token = item.trim();
    if (token === '') {
      throw new Error('keyframe spec must not contain empty items');
    }
    const frameMatch = /^(?:frame:|f)(.*)$/iu.exec(token);
    return frameMatch ? parseFrameToken(frameMatch[1], token) : parseTimeToken(token);
  });
}

function maxDurationOf(probe: VideoProbe): number {
  return Number.isFinite(probe.durationSec) && probe.durationSec >= 0
    ? probe.durationSec
    : timeAt(probe.frames, probe.fps.value);
}

function resolveTargets(
  requests: readonly KeyframeRequest[],
  probe: VideoProbe,
): ResolvedTarget[] {
  const maxDurationSec = maxDurationOf(probe);
  return requests.map((req) => {
    if (req.kind === 'time') {
      if (!Number.isFinite(req.tSec) || req.tSec < 0 || req.tSec > maxDurationSec) {
        throw new Error(
          `keyframe timestamp ${req.tSec}s is out of range [0, ${maxDurationSec}]`,
        );
      }
      const frame = Math.min(
        probe.frames - 1,
        Math.max(0, Math.round(req.tSec * probe.fps.value)),
      );
      return { tSec: req.tSec, frame };
    }
    if (!Number.isInteger(req.frame) || req.frame < 0 || req.frame >= probe.frames) {
      throw new Error(
        `keyframe frame ${req.frame} is out of range [0, ${probe.frames - 1}]`,
      );
    }
    return { tSec: timeAt(req.frame, probe.fps.value), frame: req.frame };
  });
}

function nearestTrackRecord(
  records: readonly TrackRecord[],
  tSec: number,
): TrackRecord | null {
  if (records.length === 0) return null;
  let lo = 0;
  let hi = records.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (records[mid].tSec <= tSec) lo = mid;
    else hi = mid;
  }
  return Math.abs(tSec - records[lo].tSec) <= Math.abs(records[hi].tSec - tSec)
    ? records[lo]
    : records[hi];
}

function absAltitudeOf(record: TrackRecord | null): number | null {
  if (!record) return null;
  if (record.altAbs !== null && record.altAbs !== undefined) return record.altAbs;
  if (record.gpsAltMm !== null && record.gpsAltMm !== undefined) {
    return record.gpsAltMm / 1000;
  }
  return null;
}

function hasAnySnapshotValue(snapshot: TelemetrySnapshot): boolean {
  return (
    snapshot.lat !== null ||
    snapshot.lon !== null ||
    snapshot.altRelM !== null ||
    snapshot.altAbsM !== null ||
    snapshot.speedMps !== null ||
    snapshot.headingDeg !== null ||
    snapshot.gimbalPitchDeg !== null ||
    snapshot.gimbalYawDeg !== null ||
    snapshot.iso !== null ||
    snapshot.shutterTime !== null
  );
}

function buildSnapshotLookup(
  loaded: SourceSamples | null,
  probe: VideoProbe,
): (tSec: number, frame: number) => TelemetrySnapshot | null {
  if (!loaded || loaded.trackValues.length === 0) {
    return () => null;
  }
  const fixCount = loaded.samples.filter((sample) => sample.fix !== null).length;
  const telemetry: Telemetry | null =
    fixCount >= 2
      ? computeTelemetry(loaded, { frames: probe.frames, fpsValue: probe.fps.value })
      : null;

  return (tSec: number, frame: number): TelemetrySnapshot | null => {
    const record = nearestTrackRecord(loaded.trackValues, tSec);
    const frameData = telemetry?.frames[frame];
    const snapshot: TelemetrySnapshot = {
      lat: frameData?.fix?.lat ?? record?.lat ?? null,
      lon: frameData?.fix?.lon ?? record?.lng ?? null,
      altRelM: record?.altRel ?? null,
      altAbsM: absAltitudeOf(record),
      speedMps: frameData?.speed ?? null,
      headingDeg: frameData?.headingDeg ?? record?.yawDeg ?? null,
      gimbalPitchDeg: record?.gimbalPitchDeg ?? null,
      gimbalYawDeg: record?.gimbalYawDeg ?? null,
      iso: record?.iso ?? null,
      shutterTime: record?.shutterTime ?? null,
    };
    return hasAnySnapshotValue(snapshot) ? snapshot : null;
  };
}

function outputDimensions(
  probe: VideoProbe,
  maxWidth: number | undefined,
): { width: number; height: number; scaleArgs: string[] } {
  const scaled = maxWidth !== undefined && probe.width > 0 && maxWidth < probe.width;
  const width = scaled ? maxWidth : probe.width;
  if (probe.width <= 0 || probe.height <= 0) {
    return {
      width,
      height: 0,
      scaleArgs: scaled ? ['-vf', `scale=${width}:-2`] : [],
    };
  }
  if (!scaled) {
    return { width, height: probe.height, scaleArgs: [] };
  }
  // YUV420 JPEG encoders require even heights; compute the exact even height so
  // the reported dimensions match what ffmpeg writes.
  const rawHeight = (probe.height * width) / probe.width;
  const height = probe.height === 1 ? 1 : Math.max(2, Math.round(rawHeight / 2) * 2);
  return {
    width,
    height,
    scaleArgs: ['-vf', `scale=${width}:${height}`],
  };
}

function allocateOutPath(
  outDir: string,
  stem: string,
  frame: number,
  tSec: number,
  usedPaths: Set<string>,
): string {
  const ms = Math.round(tSec * 1000);
  const baseName = `${stem}_f${frame}_${ms}ms`;
  let candidate = path.join(outDir, `${baseName}.jpg`);
  let suffix = 2;
  while (usedPaths.has(candidate)) {
    candidate = path.join(outDir, `${baseName}_${suffix}.jpg`);
    suffix++;
  }
  usedPaths.add(candidate);
  return candidate;
}

export async function extractKeyframes(
  videoPath: string,
  options: ExtractKeyframesOptions,
): Promise<ExtractedKeyframe[]> {
  if (options.at.length === 0) {
    throw new Error('at least one keyframe target is required');
  }
  if (
    options.maxWidth !== undefined &&
    (!Number.isInteger(options.maxWidth) || options.maxWidth < 1)
  ) {
    throw new Error('max-width must be a positive integer');
  }
  options.signal?.throwIfAborted();

  const probe = await probeVideo(options.tools, videoPath, undefined, options.signal);
  const targets = resolveTargets(options.at, probe);
  const loaded = await loadTelemetrySamples(
    options.tools,
    videoPath,
    probe.durationSec,
    probe.camMeta,
    options.signal,
  );
  const snapshotAt = buildSnapshotLookup(loaded, probe);
  const { width, height, scaleArgs } = outputDimensions(probe, options.maxWidth);

  const outDir = options.outDir ?? path.dirname(videoPath);
  fs.mkdirSync(outDir, { recursive: true });
  const stem = path.basename(videoPath, path.extname(videoPath));
  const usedPaths = new Set<string>();

  const results: ExtractedKeyframe[] = [];
  for (const { tSec, frame } of targets) {
    options.signal?.throwIfAborted();
    const outPath = allocateOutPath(outDir, stem, frame, tSec, usedPaths);
    try {
      // Fast input seeking: -ss before -i avoids decoding preceding GOPs.
      await runTool(
        options.tools.ffmpeg,
        [
          '-v', 'error',
          '-y',
          '-ss', tSec.toFixed(3),
          '-i', videoPath,
          '-frames:v', '1',
          ...scaleArgs,
          outPath,
        ],
        { signal: options.signal },
      );
    } catch (e) {
      if (options.signal?.aborted) throw e;
      throw new Error(`ffmpeg failed while extracting keyframe at ${tSec.toFixed(3)}s`, {
        cause: e,
      });
    }
    results.push({
      path: outPath,
      tSec,
      frame,
      width,
      height,
      telemetry: snapshotAt(tSec, frame),
    });
  }
  return results;
}
