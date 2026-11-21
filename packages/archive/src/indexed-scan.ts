import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import { findSrtSidecar } from 'drone-path-core/srt-sidecar';

import { decimateSegments, sampleSegments } from './scan-track.js';
import { discoverRecordings, scanRecordings } from './scanner.js';
import type { ScanOptions, ScanRecord } from './scanner.js';
import { ArchiveStore, CLIP_FINGERPRINT_VERSION } from './store.js';
import type { ClipFingerprint, ClipUpdate } from './store.js';

export interface IndexedScanOptions extends Omit<ScanOptions, 'tools' | 'onTrack'> {
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

async function fingerprint(file: string): Promise<ClipFingerprint | null> {
  const video = await fileStats(file);
  if (!video) return null;
  let sidecar: string | null;
  try {
    sidecar = findSrtSidecar(file);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return null;
  }
  const srt = sidecar === null ? null : await fileStats(sidecar);
  return {
    size: video.size, mtimeMs: video.mtimeMs,
    srtSize: srt?.size ?? null, srtMtimeMs: srt?.mtimeMs ?? null,
    schemaVersion: CLIP_FINGERPRINT_VERSION,
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
  const store = new ArchiveStore(options.db);
  try {
    return await indexFolders(store, dirs, options);
  } finally {
    store.close();
  }
}

async function indexFolders(store: ArchiveStore, dirs: readonly string[], options: IndexedScanOptions): Promise<ScanRecord[]> {
  const { signal, recurse, prune, onRecord } = options;
  const { revision, clips } = store.snapshot();
  const previous = new Map(clips.map((clip) => [clip.key, clip]));
  const { roots, present } = await scanRoots(dirs, clips.map(({ record }) => record.path), options);
  const files = await discoverRecordings(present, { recurse, signal });
  const records = new Map<string, ScanRecord>();
  const pending = new Map<string, ClipFingerprint>();
  const seen = new Set<string>();
  const online: string[] = [];

  for (const file of files) {
    signal?.throwIfAborted();
    const key = clipKey(file);
    if (seen.has(key)) continue;
    const current = await fingerprint(file);
    if (!current) continue;
    seen.add(key);
    const prior = previous.get(key);
    if (prior && prior.record.status !== 'error' && matches(current, prior.fingerprint)) {
      records.set(file, prior.record);
      onRecord?.(prior.record);
      if (prior.availability === 'offline') online.push(key);
    } else {
      pending.set(file, current);
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
  store.commit(revision, updates, online, offline, removed);
  return files.flatMap((file) => records.get(file) ?? []);
}

async function probeChanges(
  pending: ReadonlyMap<string, ClipFingerprint>, { concurrency, signal, getTools, onRecord }: IndexedScanOptions,
): Promise<ClipUpdate[]> {
  if (pending.size === 0) return [];
  const tracks = new Map<string, Pick<ClipUpdate, 'overview' | 'samples'>>();
  const tools = await getTools();
  const scanned = await scanRecordings([...pending.keys()], {
    tools, concurrency, signal, onRecord,
    onTrack: (file, segments) => {
      tracks.set(file, { overview: decimateSegments(segments, 60, 9), samples: sampleSegments(segments) });
    },
  });
  const updates: ClipUpdate[] = [];
  for (const record of scanned) {
    signal?.throwIfAborted();
    const original = pending.get(record.path)!;
    if (!matches(original, await fingerprint(record.path))) {
      throw new Error(`recording changed during scan, rerun the scan: ${record.path}`);
    }
    updates.push({
      key: clipKey(record.path), availability: 'online', fingerprint: original, record,
      ...tracks.get(record.path) ?? { overview: [], samples: [] },
    });
  }
  return updates;
}
