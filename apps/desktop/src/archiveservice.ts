import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { scanArchive as defaultScanArchive } from 'drone-path-archive/indexed-scan';
import { archiveDbPath } from 'drone-path-archive/paths';
import {
  listArchiveFlightOverviews as defaultListArchiveFlightOverviews,
  nearArchive as defaultNearArchive,
} from 'drone-path-archive/query';
import type { listArchiveFlights as defaultListArchiveFlights } from 'drone-path-archive/query';
import { withArchiveStore as defaultWithArchiveStore } from 'drone-path-archive/store';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { LatLon } from 'drone-path-core/geo';
import { SHOT_TYPES } from 'drone-path-core/shot-segmentation';
import { parseValue, strictShape } from 'drone-path-core/validation';
import { codedDesktopError } from 'drone-path-desktop/shared/errors';
import type {
  ArchiveNearHit,
  ArchiveQueryFilters,
  ArchiveQueryResult,
  ArchiveScanProgress,
} from 'drone-path-desktop/shared/ipc';

export interface ArchiveServiceDeps {
  dbPath?: string;
  isDir?: (dirPath: string) => boolean;
  isFile?: (filePath: string) => boolean;
  getTools?: () => Promise<FfmpegToolPaths>;
  scanArchive?: typeof defaultScanArchive;
  listArchiveFlights?: typeof defaultListArchiveFlights;
  listArchiveFlightOverviews?: typeof defaultListArchiveFlightOverviews;
  nearArchive?: typeof defaultNearArchive;
  withArchiveStore?: typeof defaultWithArchiveStore;
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
  },
  {
    invalid: 'invalid archive query filters',
    unknownKey: (key) => `unknown archive query filter key ${key}`,
  },
);

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
  const withArchiveStoreFn = deps.withArchiveStore ?? defaultWithArchiveStore;
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
        const records = await scanArchiveFn(targets, {
          db: dbPath,
          recurse: true,
          signal: controller.signal,
          getTools,
          onRecord: (record) => {
            scanned += 1;
            onScanProgress({
              phase: 'scanning',
              scanned,
              currentPath: record.path,
              status: 'running',
            });
          },
        });
        onScanProgress({
          phase: 'done',
          scanned: records.length,
          total: records.length,
          status: 'done',
        });
        log(`archive scan complete: ${records.length} recording(s)`);
        return { scanned: records.length };
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
      const flights = listArchiveFlightOverviewsFn(dbPath, parsed);
      let totalCount = 0;
      let offlineCount = 0;
      for (const flight of flights) {
        for (const clip of flight.clips) {
          totalCount += 1;
          if (clip.availability === 'offline') offlineCount += 1;
        }
      }
      return { flights, totalCount, offlineCount };
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

    fileExists(filePath: string): boolean {
      return isFile(path.resolve(filePath));
    },
  };
}
