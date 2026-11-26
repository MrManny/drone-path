import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  exportArchiveMap as defaultExportArchiveMap,
  exportArchiveTracks as defaultExportArchiveTracks,
} from 'drone-path-archive/export';
import { scanArchive as defaultScanArchive } from 'drone-path-archive/indexed-scan';
import { archiveDbPath } from 'drone-path-archive/paths';
import {
  listArchiveFlightOverviews as defaultListArchiveFlightOverviews,
  nearArchive as defaultNearArchive,
} from 'drone-path-archive/query';
import type { ListFilters, listArchiveFlights as defaultListArchiveFlights } from 'drone-path-archive/query';
import type { ScanRecord } from 'drone-path-archive/scanner';
import { withArchiveStore as defaultWithArchiveStore } from 'drone-path-archive/store';
import { errorMessage } from 'drone-path-core/errors';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { LatLon } from 'drone-path-core/geo';
import { SHOT_TYPES } from 'drone-path-core/shot-segmentation';
import { parseValue, strictShape } from 'drone-path-core/validation';
import { codedDesktopError } from 'drone-path-desktop/shared/errors';
import { ARCHIVE_EXPORT_FORMATS } from 'drone-path-desktop/shared/ipc';
import type {
  ArchiveAvailability,
  ArchiveExportRequest,
  ArchiveFlightDto,
  ArchiveNearHit,
  ArchiveQueryFilters,
  ArchiveQueryResult,
  ArchiveScanProgress,
} from 'drone-path-desktop/shared/ipc';
import { posterIdFor } from './archiveposters.js';
import type { PosterRegistration } from './archiveposters.js';

export interface ArchiveServiceDeps {
  dbPath?: string;
  isDir?: (dirPath: string) => boolean;
  isFile?: (filePath: string) => boolean;
  getTools?: () => Promise<FfmpegToolPaths>;
  scanArchive?: typeof defaultScanArchive;
  listArchiveFlights?: typeof defaultListArchiveFlights;
  listArchiveFlightOverviews?: typeof defaultListArchiveFlightOverviews;
  nearArchive?: typeof defaultNearArchive;
  exportArchiveTracks?: typeof defaultExportArchiveTracks;
  exportArchiveMap?: typeof defaultExportArchiveMap;
  withArchiveStore?: typeof defaultWithArchiveStore;
  registerPoster?: (clip: PosterRegistration) => string;
}

export interface ArchiveServiceOptions {
  getRoots: () => readonly string[];
  addRootState: (dir: string) => readonly string[];
  removeRootState: (dir: string) => readonly string[];
  onScanProgress?: (progress: ArchiveScanProgress) => void;
  log?: (message: string) => void;
  deps?: ArchiveServiceDeps;
}

export interface ArchiveService {
  listRoots(): string[];
  addRoot(dir: string): string[];
  removeRoot(dir: string): string[];
  scan(roots?: string[]): Promise<{ scanned: number }>;
  cancelScan(): void;
  query(filters?: ArchiveQueryFilters): ArchiveQueryResult;
  findAtPoint(point: LatLon, radiusM?: number, includeGaze?: boolean): ArchiveNearHit[];
  exportArchive(request: ArchiveExportRequest): void;
  pruneOffline(): number;
  clipAvailability(clipPath: string): ArchiveAvailability | null;
  fileExists(filePath: string): boolean;
}

const BBOX_SCHEMA = strictShape(
  {
    minLat: z.number().finite(),
    maxLat: z.number().finite(),
    minLon: z.number().finite(),
    maxLon: z.number().finite(),
  },
  {
    invalid: 'invalid archive query bbox',
    unknownKey: (key) => `unknown archive query bbox key ${key}`,
  },
);

const QUERY_FILTERS_SCHEMA = strictShape(
  {
    bbox: BBOX_SCHEMA.optional(),
    afterMs: z.number().finite().optional(),
    beforeMs: z.number().finite().optional(),
    minDistanceM: z.number().finite().min(0).optional(),
    availability: z.enum(['online', 'offline']).optional(),
    segmentType: z.enum(SHOT_TYPES).optional(),
    minSmoothness: z.number().finite().min(0).max(1).optional(),
    folderRoot: z.string().min(1).optional(),
    flightId: z.string().min(1).optional(),
  },
  {
    invalid: 'invalid archive query filters',
    unknownKey: (key) => `unknown archive query filter key ${key}`,
  },
);

const ARCHIVE_EXPORT_SCHEMA = strictShape(
  {
    outPath: z.string().min(1, { error: () => 'invalid archive export request: outPath' }),
    format: z.enum(ARCHIVE_EXPORT_FORMATS),
    filters: QUERY_FILTERS_SCHEMA.optional(),
    redactLaunchM: z.number().finite().min(0).optional(),
    includeGaze: z.boolean().optional(),
    offline: z.boolean().optional(),
  },
  {
    invalid: 'invalid archive export request',
    unknownKey: (key) => `unknown archive export request key ${key}`,
  },
);

export function parseArchiveExportRequest(raw: unknown): ArchiveExportRequest {
  const parsed = parseValue(ARCHIVE_EXPORT_SCHEMA, raw);
  if (!path.isAbsolute(parsed.outPath)) {
    throw codedDesktopError(
      'OUTPUT_PATH_ABSOLUTE',
      `output path must be absolute: ${parsed.outPath}`,
    );
  }
  const ext = path.extname(parsed.outPath).toLowerCase();
  if (ext !== `.${parsed.format}`) {
    throw codedDesktopError(
      'INVALID_REQUEST',
      `archive export path extension (${ext || 'none'}) does not match format ${parsed.format}`,
    );
  }
  return parsed;
}

function toListFilters(filters: ArchiveQueryFilters): ListFilters {
  const { folderRoot: _folderRoot, flightId: _flightId, ...rest } = filters;
  return rest;
}

const POINT_SCHEMA = strictShape(
  {
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
  },
  {
    invalid: 'invalid archive lookup point',
    unknownKey: (key) => `unknown archive point key ${key}`,
  },
);

function defaultIsDir(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function defaultIsFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isWithinScanRoot(root: string, filePath: string): boolean {
  const rel = path.relative(path.resolve(root), filePath);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function clipLookupKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function requireNonEmptyPath(raw: unknown, code: 'ARCHIVE_ROOT_INVALID' | 'INVALID_REQUEST'): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    if (code === 'ARCHIVE_ROOT_INVALID') {
      throw codedDesktopError('ARCHIVE_ROOT_INVALID', 'archive folder path must not be empty');
    }
    throw codedDesktopError('INVALID_REQUEST', 'path must be a non-empty string');
  }
  return path.resolve(raw);
}

export function createArchiveService(options: ArchiveServiceOptions): ArchiveService {
  const deps = options.deps ?? {};
  const dbPath = deps.dbPath ?? archiveDbPath();
  const isDir = deps.isDir ?? defaultIsDir;
  const isFile = deps.isFile ?? defaultIsFile;
  const scanArchiveFn = deps.scanArchive ?? defaultScanArchive;
  const listArchiveFlightOverviewsFn =
    deps.listArchiveFlightOverviews ??
    deps.listArchiveFlights ??
    defaultListArchiveFlightOverviews;
  const nearArchiveFn = deps.nearArchive ?? defaultNearArchive;
  const exportArchiveTracksFn = deps.exportArchiveTracks ?? defaultExportArchiveTracks;
  const exportArchiveMapFn = deps.exportArchiveMap ?? defaultExportArchiveMap;
  const withArchiveStoreFn = deps.withArchiveStore ?? defaultWithArchiveStore;
  const registerPoster = deps.registerPoster;
  const onScanProgress = options.onScanProgress ?? ((): void => {});
  const log = options.log ?? ((): void => {});
  const getTools =
    deps.getTools ??
    (async (): Promise<FfmpegToolPaths> => {
      throw new Error('ffmpeg tools not configured for archive scan');
    });

  let activeScan: AbortController | null = null;

  return {
    listRoots(): string[] {
      return [...options.getRoots()];
    },

    addRoot(dir: string): string[] {
      const resolved = requireNonEmptyPath(dir, 'ARCHIVE_ROOT_INVALID');
      if (!isDir(resolved)) {
        throw codedDesktopError(
          'ARCHIVE_ROOT_INVALID',
          `archive folder is not a readable directory: ${resolved}`,
          { name: path.basename(resolved) || resolved },
        );
      }
      return [...options.addRootState(resolved)];
    },

    removeRoot(dir: string): string[] {
      const resolved = requireNonEmptyPath(dir, 'ARCHIVE_ROOT_INVALID');
      const next = [...options.removeRootState(resolved)];
      withArchiveStoreFn(dbPath, (store) => store.removeClipsUnder(resolved));
      return next;
    },

    async scan(roots?: string[]): Promise<{ scanned: number }> {
      if (activeScan !== null) {
        throw codedDesktopError('ARCHIVE_SCAN_RUNNING', 'an archive scan is already running');
      }
      const targets =
        roots === undefined
          ? [...options.getRoots()]
          : parseValue(z.array(z.string().min(1)), roots).map((dir) =>
              requireNonEmptyPath(dir, 'ARCHIVE_ROOT_INVALID'),
            );

      if (targets.length === 0) {
        onScanProgress({ phase: 'done', scanned: 0, total: 0, status: 'done' });
        return { scanned: 0 };
      }

      const controller = new AbortController();
      activeScan = controller;
      let scanned = 0;
      onScanProgress({ phase: 'scanning', scanned: 0, status: 'running' });

      try {
        const onlineRoots: string[] = [];
        const offlineRoots: string[] = [];
        for (const root of targets) {
          if (isDir(root)) onlineRoots.push(root);
          else offlineRoots.push(root);
        }

        // Only pass unreachable roots that already have indexed clips: scanRoots
        // throws ENOENT when prune is false and a missing root has zero indexed paths.
        const offlineWithClips =
          offlineRoots.length === 0
            ? []
            : withArchiveStoreFn(dbPath, (store) => {
                const indexedPaths = store.snapshot().clips.map((clip) => clip.record.path);
                return offlineRoots.filter((root) =>
                  indexedPaths.some((filePath) => isWithinScanRoot(root, filePath)),
                );
              });

        let totalScanned = 0;
        const onRecord = (record: ScanRecord) => {
          scanned += 1;
          onScanProgress({
            phase: 'scanning',
            scanned,
            currentPath: record.path,
            status: 'running',
          });
        };

        if (onlineRoots.length > 0) {
          const onlineRecords = await scanArchiveFn(onlineRoots, {
            db: dbPath,
            recurse: true,
            prune: true,
            signal: controller.signal,
            getTools,
            onRecord,
          });
          totalScanned += onlineRecords.length;
        }

        if (offlineWithClips.length > 0) {
          controller.signal.throwIfAborted();
          const offlineRecords = await scanArchiveFn(offlineWithClips, {
            db: dbPath,
            recurse: true,
            prune: false,
            signal: controller.signal,
            getTools,
            onRecord,
          });
          totalScanned += offlineRecords.length;
        }

        onScanProgress({
          phase: 'done',
          scanned: totalScanned,
          total: totalScanned,
          status: 'done',
        });
        log(`archive scan complete: ${totalScanned} recording(s)`);
        return { scanned: totalScanned };
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          onScanProgress({ phase: 'canceled', scanned, status: 'canceled' });
          log('archive scan canceled');
          throw codedDesktopError('ARCHIVE_SCAN_CANCELED', 'archive scan canceled', undefined, error);
        }
        onScanProgress({ phase: 'error', scanned, status: 'error' });
        throw error;
      } finally {
        if (activeScan === controller) activeScan = null;
      }
    },

    cancelScan(): void {
      activeScan?.abort();
    },

    query(filters?: ArchiveQueryFilters): ArchiveQueryResult {
      const parsed =
        filters === undefined ? {} : parseValue(QUERY_FILTERS_SCHEMA, filters);
      const rawFlights = listArchiveFlightOverviewsFn(dbPath, toListFilters(parsed));
      const folderRoot = parsed.folderRoot ? path.resolve(parsed.folderRoot) : null;
      const flights: ArchiveFlightDto[] = [];
      let totalCount = 0;
      let offlineCount = 0;

      for (const flight of rawFlights) {
        if (parsed.flightId !== undefined && flight.flightId !== parsed.flightId) continue;
        const matchedClips = folderRoot
          ? flight.clips.filter((clip) => isWithinScanRoot(folderRoot, clip.path))
          : flight.clips;
        if (matchedClips.length === 0) continue;

        const mappedClips = matchedClips.map((clip) => {
          totalCount += 1;
          if (clip.availability === 'offline') offlineCount += 1;
          const registration: PosterRegistration = {
            path: clip.path,
            mtimeMs: clip.mtimeMs,
            size: clip.size,
            durationSec: clip.video?.durationSec ?? null,
            availability: clip.availability,
          };
          const posterId = registerPoster
            ? registerPoster(registration)
            : posterIdFor(clip.path, clip.mtimeMs, clip.size);
          return { ...clip, posterId };
        });
        flights.push({ flightId: flight.flightId, clips: mappedClips });
      }
      const offlineRoots = options.getRoots().filter((root) => !isDir(root));
      return offlineRoots.length > 0
        ? { flights, totalCount, offlineCount, offlineRoots }
        : { flights, totalCount, offlineCount };
    },

    findAtPoint(point: LatLon, radiusM?: number, includeGaze = true): ArchiveNearHit[] {
      const parsedPoint = parseValue(POINT_SCHEMA, point);
      const parsedRadius =
        radiusM === undefined
          ? undefined
          : parseValue(z.number().finite().positive(), radiusM);
      const parsedGaze = parseValue(z.boolean(), includeGaze);
      return nearArchiveFn(dbPath, parsedPoint, parsedRadius, parsedGaze);
    },

    exportArchive(request: ArchiveExportRequest): void {
      const parsed = parseArchiveExportRequest(request);
      const listFilters = parsed.filters ? toListFilters(parsed.filters) : undefined;
      try {
        if (parsed.format === 'html') {
          exportArchiveMapFn(dbPath, parsed.outPath, {
            ...(listFilters ? { filters: listFilters } : {}),
            ...(parsed.redactLaunchM !== undefined ? { redactLaunchM: parsed.redactLaunchM } : {}),
            ...(parsed.includeGaze !== undefined ? { includeGaze: parsed.includeGaze } : {}),
            ...(parsed.offline !== undefined ? { offline: parsed.offline } : {}),
          });
        } else {
          exportArchiveTracksFn(dbPath, parsed.outPath, {
            ...(listFilters ? { filters: listFilters } : {}),
            ...(parsed.redactLaunchM !== undefined ? { redactLaunchM: parsed.redactLaunchM } : {}),
          });
        }
        log(`archive export complete: ${parsed.outPath}`);
      } catch (error) {
        throw codedDesktopError(
          'ARCHIVE_EXPORT_FAILED',
          `archive export failed: ${errorMessage(error)}`,
          undefined,
          error,
        );
      }
    },

    pruneOffline(): number {
      return withArchiveStoreFn(dbPath, (store) => store.pruneOffline());
    },

    clipAvailability(clipPath: string): ArchiveAvailability | null {
      const key = clipLookupKey(clipPath);
      return withArchiveStoreFn(dbPath, (store) => {
        const match = store.snapshot().clips.find((clip) => clip.key === key);
        return match?.availability ?? null;
      });
    },

    fileExists(filePath: string): boolean {
      return isFile(path.resolve(filePath));
    },
  };
}
