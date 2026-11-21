import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import PQueue from 'p-queue';
import { errorMessage } from 'drone-path-core/errors';
import { probeVideo } from 'drone-path-core/ffmpeg';
import type { VideoProbe } from 'drone-path-core/ffmpeg';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { Bbox } from 'drone-path-core/geo';
import { loadTelemetrySamples } from 'drone-path-core/telemetry';
import type { SourceSamples } from 'drone-path-core/telemetry';

import { sampleGaze } from './gaze.js';
import type { GazeSample } from './gaze.js';
import { summarizeTrack } from './scan-track.js';
import type { ScanPoint } from './scan-track.js';

export type ScanStatus = 'ok' | 'no-telemetry' | 'no-gps' | 'error';

type ScanVideo = Pick<VideoProbe, 'fps' | 'frames' | 'width' | 'height'> & { durationSec: number | null };

export interface ScanRecord {
  path: string;
  size: number | null;
  mtimeMs: number | null;
  status: ScanStatus;
  video: ScanVideo | null;
  /** Original camera tag, with unverified accuracy and time zone. */
  cameraCreationTime: string | null;
  telemetry: {
    source: SourceSamples['source'];
    method: SourceSamples['method'];
    fixCount: number;
    noLock: number;
    trackDistanceM: number;
  } | null;
  bbox: Bbox | null;
  track: ScanPoint[][];
  error: string | null;
}

export interface ScanOptions {
  tools: FfmpegToolPaths;
  recurse?: boolean;
  concurrency?: number;
  signal?: AbortSignal;
  onRecord?: (record: ScanRecord) => void;
  onTrack?: (file: string, segments: ScanPoint[][]) => void;
  onGaze?: (file: string, samples: GazeSample[]) => void;
}

function isRecording(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.mp4') && !lower.endsWith('_map.mp4');
}

export async function discoverRecordings(
  dirs: readonly string[], { recurse, signal }: Pick<ScanOptions, 'recurse' | 'signal'> = {},
): Promise<string[]> {
  const visited = new Set<string>();
  const found: string[] = [];
  const pending: string[] = [];
  for (const dir of dirs) {
    signal?.throwIfAborted();
    pending.push(await realpath(dir));
  }
  for (const dir of pending) {
    signal?.throwIfAborted();
    if (visited.has(dir)) continue;
    visited.add(dir);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && recurse) pending.push(full);
      if (entry.isFile() && isRecording(entry.name)) found.push(full);
    }
  }
  return found.sort();
}

export async function scanRecording(
  file: string, { tools, signal, onTrack, onGaze }: Pick<ScanOptions, 'tools' | 'signal' | 'onTrack' | 'onGaze'>,
): Promise<ScanRecord> {
  signal?.throwIfAborted();
  const record: ScanRecord = {
    path: file, size: null, mtimeMs: null, status: 'error', video: null,
    cameraCreationTime: null, telemetry: null, bbox: null, track: [], error: null,
  };
  try {
    const stats = await stat(file);
    if (!stats.isFile()) throw new Error('recording is no longer a regular file');
    record.size = stats.size;
    record.mtimeMs = stats.mtimeMs;
    signal?.throwIfAborted();
    const { fps, frames, width, height, durationSec, creationTime, camMeta } =
      await probeVideo(tools, file, undefined, signal);
    record.video = { fps, frames, width, height, durationSec: Number.isFinite(durationSec) ? durationSec : null };
    record.cameraCreationTime = creationTime ?? null;

    const loaded = await loadTelemetrySamples(tools, file, durationSec, camMeta, signal);
    signal?.throwIfAborted();
    if (!loaded) {
      record.status = 'no-telemetry';
      return record;
    }
    if (loaded.trackValues.length === 0) {
      throw new Error('cam meta stream contains no readable telemetry samples');
    }

    const { bbox, track, fixCount, trackDistanceM } = summarizeTrack(
      loaded.trackValues, onTrack && ((segments) => onTrack(file, segments)),
    );
    record.bbox = bbox;
    record.track = track;
    record.telemetry = { source: loaded.source, method: loaded.method, fixCount, noLock: loaded.noLock, trackDistanceM };
    if (onGaze && loaded.method === 'dvtm-packets') onGaze(file, sampleGaze(loaded.trackValues));
    record.status = fixCount > 0 ? 'ok' : 'no-gps';
  } catch (error) {
    signal?.throwIfAborted();
    record.error = errorMessage(error);
  }
  return record;
}

export async function scanFolders(dirs: readonly string[], options: ScanOptions): Promise<ScanRecord[]> {
  const files = await discoverRecordings(dirs, options);
  return scanRecordings(files, options);
}

export async function scanRecordings(files: readonly string[], options: ScanOptions): Promise<ScanRecord[]> {
  const queue = new PQueue({ concurrency: options.concurrency ?? 4 });
  // Wait for active tasks to release their file handles and child processes after abort.
  const results = await Promise.allSettled(files.map((file) => queue.add(async () => {
    const record = await scanRecording(file, options);
    options.onRecord?.(record);
    return record;
  })));
  options.signal?.throwIfAborted();
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
}
