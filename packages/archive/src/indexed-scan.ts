import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import { createSrtSidecarLookup } from 'drone-path-core/srt-sidecar';

import { decimateSegments, sampleSegments } from './scan-track.js';
import { discoverRecordings, scanRecordings } from './scanner.js';
import type { ScanOptions, ScanRecord } from './scanner.js';
import { CLIP_FINGERPRINT_VERSION, withArchiveStoreAsync } from './store.js';
import type { ArchiveStore, ClipFingerprint, ClipUpdate } from './store.js';

export interface IndexedScanOptions extends Omit<ScanOptions, 'tools' | 'sidecarFor' | 'onTrack' | 'onGaze'> {
  db: string;
  prune?: boolean;
  getTools: () => Promise<FfmpegToolPaths>;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function clipKey(file: string): string {
  return process.platform === 'win32' ? file.toLowerCase() : file;
}

function within(root: string, file: string, recurse?: boolean): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
    && (recurse === true || !rel.includes(path.sep));
}

async function fileStats(file: string) {
  try {
    const entry = await stat(file);
    return entry.isFile() ? entry : null;
  } catch (error) {
    if (!isMissing(error)) throw error;
    return null;
  }
}

interface ClipInput {
  fingerprint: ClipFingerprint;
  sidecar: string | null;
}

async function inspectInput(
  file: string, sidecarFor: ReturnType<typeof createSrtSidecarLookup>,
): Promise<ClipInput | null> {
  const video = await fileStats(file);
  if (!video) return null;
  let sidecar: string | null;
  try {
    sidecar = await sidecarFor(file);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return null;
  }
  const srt = sidecar === null ? null : await fileStats(sidecar);
  return {
    sidecar,
    fingerprint: {
      size: video.size, mtimeMs: video.mtimeMs,
      srtSize: srt?.size ?? null, srtMtimeMs: srt?.mtimeMs ?? null,
      schemaVersion: CLIP_FINGERPRINT_VERSION,
    },
  };
}

function matches(a: ClipFingerprint, b: ClipFingerprint | null | undefined): boolean {
  return !!b && a.size === b.size && a.mtimeMs === b.mtimeMs && a.srtSize === b.srtSize
    && a.srtMtimeMs === b.srtMtimeMs && a.schemaVersion === b.schemaVersion;
}

async function scanRoots(
  dirs: readonly string[], indexedPaths: readonly string[], { prune, recurse, signal }: IndexedScanOptions,
) {
  const roots: string[] = [];
  const present: string[] = [];
  for (const dir of dirs) {
    signal?.throwIfAborted();
    try {
      const canonical = await realpath(dir);
      roots.push(canonical);
      present.push(canonical);
    } catch (error) {
      const absolute = path.resolve(dir);
      if (!isMissing(error) || (prune !== true && !indexedPaths.some((file) => within(absolute, file, recurse)))) {
        throw error;
      }
      roots.push(absolute);
    }
  }
  return { roots, present };
}

export async function scanArchive(dirs: readonly string[], options: IndexedScanOptions): Promise<ScanRecord[]> {
  return withArchiveStoreAsync(options.db, (store) => indexFolders(store, dirs, options));
}

async function indexFolders(store: ArchiveStore, dirs: readonly string[], options: IndexedScanOptions): Promise<ScanRecord[]> {
  const { signal, recurse, prune, onRecord } = options;
  const { revision, clips } = store.snapshot();
  const previous = new Map(clips.map((clip) => [clip.key, clip]));
  const { roots, present } = await scanRoots(dirs, clips.map(({ record }) => record.path), options);
  const files = await discoverRecordings(present, { recurse, signal });
  const records = new Map<string, ScanRecord>();
  const pending = new Map<string, ClipInput>();
  const sidecarFor = createSrtSidecarLookup();
  const seen = new Set<string>();
  const backfills = new Set<string>();
  const online: string[] = [];

  for (const file of files) {
    signal?.throwIfAborted();
    const key = clipKey(file);
    if (seen.has(key)) continue;
    const current = await inspectInput(file, sidecarFor);
    if (!current) continue;
    seen.add(key);
    const prior = previous.get(key);
    const unchanged = prior && matches(current.fingerprint, prior.fingerprint);
    if (unchanged && !prior.gazePending && prior.record.status !== 'error') {
      records.set(file, prior.record);
      onRecord?.(prior.record);
      if (prior.availability === 'offline') online.push(key);
    } else {
      pending.set(file, current);
      if (unchanged && prior.gazePending) {
        backfills.add(file);
        if (prior.availability === 'offline') online.push(key);
      }
    }
  }

  const updates = await probeChanges(pending, options);
  for (const update of updates) records.set(update.record.path, update.record);

  const offline: string[] = [];
  const removed: string[] = [];
  for (const { key, record, availability } of clips) {
    signal?.throwIfAborted();
    if (seen.has(key) || !roots.some((root) => within(root, record.path, recurse))) continue;
    if (await fileStats(record.path)) continue;
    if (prune) removed.push(key);
    else if (availability === 'online') offline.push(key);
  }

  signal?.throwIfAborted();
  // A failed footprint backfill leaves the existing track indexed and retryable.
  const successfulUpdates = updates.filter(({ record }) => record.status !== 'error' || !backfills.has(record.path));
  store.commit(revision, successfulUpdates, online, offline, removed);
  return files.flatMap((file) => records.get(file) ?? []);
}

async function probeChanges(
  pending: ReadonlyMap<string, ClipInput>, { concurrency, signal, getTools, onRecord }: IndexedScanOptions,
): Promise<ClipUpdate[]> {
  if (pending.size === 0) return [];
  const tracks = new Map<string, Pick<ClipUpdate, 'overview' | 'samples'>>();
  const gaze = new Map<string, NonNullable<ClipUpdate['gaze']>>();
  const tools = await getTools();
  const scanned = await scanRecordings([...pending.keys()], {
    tools, concurrency, signal, onRecord,
    sidecarFor: (file) => pending.get(file)?.sidecar,
    onGaze: (file, samples) => gaze.set(file, samples),
    onTrack: (file, segments) => {
      tracks.set(file, { overview: decimateSegments(segments, 60, 9), samples: sampleSegments(segments) });
    },
  });
  const updates: ClipUpdate[] = [];
  const sidecarFor = createSrtSidecarLookup();
  for (const record of scanned) {
    signal?.throwIfAborted();
    const original = pending.get(record.path)!;
    const current = await inspectInput(record.path, sidecarFor);
    if (!current || original.sidecar !== current.sidecar || !matches(original.fingerprint, current.fingerprint)) {
      throw new Error(`recording changed during scan, rerun the scan: ${record.path}`);
    }
    updates.push({
      key: clipKey(record.path), availability: 'online', fingerprint: original.fingerprint, record,
      ...tracks.get(record.path) ?? { overview: [], samples: [] },
      gaze: gaze.get(record.path),
    });
  }
  return updates;
}
