'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Bbox, LatLon } from 'drone-path-core/geo';
import type { ShotType } from 'drone-path-core/shot-segmentation';
import { classifyError, fromIpcFailure } from '../../shared/errors.js';
import type { StructuredError } from '../../shared/errors.js';
import type {
  ArchiveFlightDto,
  ArchiveNearHit,
  ArchiveQueryFilters,
  ArchiveScanProgress,
} from '../../shared/ipc.js';
import { tryAppBridge } from '../lib/backend.js';
import { useMountedRef } from './useMountedRef.js';

const DEFAULT_POINT_QUERY_RADIUS_M = 100;

export interface ArchiveFilterState {
  afterDate: string;
  beforeDate: string;
  folderRoot: string;
  flightId: string;
  minDistanceM: string;
  segmentType: ShotType | '';
  minSmoothness: number;
  onlyInMapView: boolean;
}

export const DEFAULT_ARCHIVE_FILTERS: ArchiveFilterState = {
  afterDate: '',
  beforeDate: '',
  folderRoot: '',
  flightId: '',
  minDistanceM: '',
  segmentType: '',
  minSmoothness: 0,
  onlyInMapView: false,
};

const DAY_MS = 86_400_000;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDayStartMs(dateStr: string): number | undefined {
  if (!ISO_DAY_RE.test(dateStr)) return undefined;
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

function parsePositiveDistance(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function countActiveArchiveFilters(filters: ArchiveFilterState): number {
  let count = 0;
  if (parseDayStartMs(filters.afterDate) !== undefined) count += 1;
  if (parseDayStartMs(filters.beforeDate) !== undefined) count += 1;
  if (filters.folderRoot !== '') count += 1;
  if (filters.flightId !== '') count += 1;
  if (parsePositiveDistance(filters.minDistanceM) !== undefined) count += 1;
  if (filters.segmentType !== '') count += 1;
  if (filters.minSmoothness > 0) count += 1;
  if (filters.onlyInMapView) count += 1;
  return count;
}

export function buildArchiveQueryFilters(
  filters: ArchiveFilterState,
  viewportBbox: Bbox | null,
): ArchiveQueryFilters | undefined {
  const query: ArchiveQueryFilters = {};
  let hasFilter = false;

  const afterMs = parseDayStartMs(filters.afterDate);
  if (afterMs !== undefined) {
    query.afterMs = afterMs;
    hasFilter = true;
  }

  const beforeStartMs = parseDayStartMs(filters.beforeDate);
  if (beforeStartMs !== undefined) {
    query.beforeMs = beforeStartMs + DAY_MS;
    hasFilter = true;
  }

  if (filters.folderRoot !== '') {
    query.folderRoot = filters.folderRoot;
    hasFilter = true;
  }

  if (filters.flightId !== '') {
    query.flightId = filters.flightId;
    hasFilter = true;
  }

  const minDistanceM = parsePositiveDistance(filters.minDistanceM);
  if (minDistanceM !== undefined) {
    query.minDistanceM = minDistanceM;
    hasFilter = true;
  }

  if (filters.segmentType !== '') {
    query.segmentType = filters.segmentType;
    hasFilter = true;
  }

  if (filters.minSmoothness > 0) {
    query.minSmoothness = filters.minSmoothness;
    hasFilter = true;
  }

  if (filters.onlyInMapView && viewportBbox !== null) {
    query.bbox = viewportBbox;
    hasFilter = true;
  }

  return hasFilter ? query : undefined;
}

export interface ArchiveWorkspaceState {
  roots: string[];
  offlineRoots: ReadonlySet<string>;
  flights: ArchiveFlightDto[];
  availableFlightIds: string[];
  totalCount: number;
  offlineCount: number;
  scanning: boolean;
  pruning: boolean;
  lastPrunedCount: number | null;
  scanProgress: ArchiveScanProgress | null;
  error: StructuredError | null;
  viewportBbox: Bbox | null;
  pointHits: ArchiveNearHit[] | null;
  pointQueryCoord: LatLon | null;
  pointQueryLoading: boolean;
  pointQueryActive: boolean;
  filters: ArchiveFilterState;
  activeFilterCount: number;
  activeQueryFilters: ArchiveQueryFilters | undefined;
  setViewportBbox: (bbox: Bbox | null) => void;
  setPointQueryActive: (active: boolean) => void;
  togglePointQuery: () => void;
  queryAtPoint: (point: LatLon, radiusM?: number) => Promise<void>;
  clearPointQuery: () => void;
  setFilters: (next: ArchiveFilterState) => void;
  clearFilters: () => void;
  addFolder: () => Promise<boolean>;
  removeFolder: (dir: string) => Promise<void>;
  rescan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  revealClip: (clipPath: string) => Promise<void>;
  pruneOffline: () => Promise<number | null>;
  dismissPruneStatus: () => void;
  dismissError: () => void;
}

function bboxEqual(a: Bbox | null, b: Bbox | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const eps = 1e-6;
  return (
    Math.abs(a.minLat - b.minLat) < eps &&
    Math.abs(a.maxLat - b.maxLat) < eps &&
    Math.abs(a.minLon - b.minLon) < eps &&
    Math.abs(a.maxLon - b.maxLon) < eps
  );
}

function normalizeForCompare(target: string): string {
  const trimmed = target.replace(/[\\/]+$/, '');
  if (trimmed === '') return target;
  return /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('\\\\')
    ? trimmed.toLowerCase()
    : trimmed;
}

function isPathUnderRoot(root: string, filePath: string): boolean {
  const normRoot = normalizeForCompare(root);
  const normFile =
    /^[a-zA-Z]:/.test(filePath) || filePath.startsWith('\\\\')
      ? filePath.toLowerCase()
      : filePath;
  if (normRoot === '/' || normRoot === '\\') {
    return normFile.startsWith(normRoot) && normFile.length > 1;
  }
  if (!normFile.startsWith(normRoot)) return false;
  const next = normFile.charAt(normRoot.length);
  return next === '/' || next === '\\';
}

function computeOfflineRoots(
  roots: readonly string[],
  flights: readonly ArchiveFlightDto[],
  reportedOfflineRoots?: readonly string[],
): ReadonlySet<string> {
  const offline = new Set<string>(reportedOfflineRoots ?? []);
  const clips = flights.flatMap((flight) => flight.clips);
  for (const root of roots) {
    if (offline.has(root)) continue;
    const underRoot = clips.filter((clip) => isPathUnderRoot(root, clip.path));
    if (underRoot.length > 0 && underRoot.every((clip) => clip.availability === 'offline')) {
      offline.add(root);
    }
  }
  return offline;
}

export function useArchiveWorkspace(onInitialRoots?: () => void): ArchiveWorkspaceState {
  const [roots, setRoots] = useState<string[]>([]);
  const [offlineRoots, setOfflineRoots] = useState<ReadonlySet<string>>(() => new Set());
  const [flights, setFlights] = useState<ArchiveFlightDto[]>([]);
  const [availableFlightIds, setAvailableFlightIds] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [lastPrunedCount, setLastPrunedCount] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<ArchiveScanProgress | null>(null);
  const [error, setError] = useState<StructuredError | null>(null);
  const [viewportBbox, setViewportBboxState] = useState<Bbox | null>(null);
  const [pointHits, setPointHits] = useState<ArchiveNearHit[] | null>(null);
  const [pointQueryCoord, setPointQueryCoord] = useState<LatLon | null>(null);
  const [pointQueryLoading, setPointQueryLoading] = useState(false);
  const [pointQueryActive, setPointQueryActive] = useState(false);
  const [filters, setFiltersState] = useState<ArchiveFilterState>(DEFAULT_ARCHIVE_FILTERS);

  const mounted = useMountedRef();
  const viewportBboxRef = useRef<Bbox | null>(null);
  const filtersRef = useRef<ArchiveFilterState>(DEFAULT_ARCHIVE_FILTERS);
  const querySeqRef = useRef(0);
  const pointQuerySeqRef = useRef(0);
  const rootsRef = useRef(roots);
  useLayoutEffect(() => {
    rootsRef.current = roots;
  }, [roots]);
  const onInitialRootsRef = useRef(onInitialRoots);
  useLayoutEffect(() => {
    onInitialRootsRef.current = onInitialRoots;
  }, [onInitialRoots]);

  const refreshQuery = useCallback(
    async (
      bbox: Bbox | null = viewportBboxRef.current,
      nextRoots?: readonly string[],
      nextFilters: ArchiveFilterState = filtersRef.current,
    ) => {
      const bridge = tryAppBridge();
      if (!bridge || typeof bridge.queryArchive !== 'function') return;
      const seq = (querySeqRef.current += 1);
      const queryFilters = buildArchiveQueryFilters(nextFilters, bbox);
      try {
        const result = await (queryFilters
          ? bridge.queryArchive(queryFilters)
          : bridge.queryArchive());
        if (!mounted.current || querySeqRef.current !== seq) return;
        const activeRoots = nextRoots ?? rootsRef.current;
        setFlights(result.flights);
        if (nextFilters.flightId === '') {
          setAvailableFlightIds(result.flights.map((flight) => flight.flightId));
        }
        setTotalCount(result.totalCount);
        setOfflineCount(result.offlineCount);
        setOfflineRoots(computeOfflineRoots(activeRoots, result.flights, result.offlineRoots));
      } catch (e) {
        if (!mounted.current || querySeqRef.current !== seq) return;
        setError(classifyError(e));
      }
    },
    [mounted],
  );

  const setViewportBbox = useCallback(
    (bbox: Bbox | null) => {
      if (bboxEqual(viewportBboxRef.current, bbox)) return;
      viewportBboxRef.current = bbox;
      setViewportBboxState(bbox);
      if (filtersRef.current.onlyInMapView) {
        void refreshQuery(bbox);
      }
    },
    [refreshQuery],
  );

  const clearPointQuery = useCallback(() => {
    pointQuerySeqRef.current += 1;
    setPointQueryCoord(null);
    setPointHits(null);
    setPointQueryLoading(false);
  }, []);

  const togglePointQuery = useCallback(() => {
    setPointQueryActive((prev) => !prev);
  }, []);

  const queryAtPoint = useCallback(
    async (point: LatLon, radiusM: number = DEFAULT_POINT_QUERY_RADIUS_M): Promise<void> => {
      const bridge = tryAppBridge();
      if (!bridge || typeof bridge.findArchiveAtPoint !== 'function') return;
      const seq = (pointQuerySeqRef.current += 1);
      setPointQueryCoord(point);
      setPointHits(null);
      setPointQueryLoading(true);
      setError(null);
      try {
        const hits = await bridge.findArchiveAtPoint(point, radiusM, true);
        if (!mounted.current || pointQuerySeqRef.current !== seq) return;
        setPointHits(hits);
      } catch (e) {
        if (!mounted.current || pointQuerySeqRef.current !== seq) return;
        setPointQueryCoord(null);
        setPointHits(null);
        setError(classifyError(e));
      } finally {
        if (mounted.current && pointQuerySeqRef.current === seq) {
          setPointQueryLoading(false);
        }
      }
    },
    [mounted],
  );

  const setFilters = useCallback(
    (next: ArchiveFilterState) => {
      filtersRef.current = next;
      setFiltersState(next);
      void refreshQuery(viewportBboxRef.current, undefined, next);
    },
    [refreshQuery],
  );

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_ARCHIVE_FILTERS);
  }, [setFilters]);
  const runScan = useCallback(
    async (targetRoots?: string[]) => {
      const bridge = tryAppBridge();
      if (!bridge || typeof bridge.scanArchive !== 'function') return;
      setScanning(true);
      setError(null);
      setLastPrunedCount(null);
      try {
        const result = await bridge.scanArchive(targetRoots);
        if (!mounted.current) return;
        if (!result.ok) {
          if (result.code !== 'ARCHIVE_SCAN_CANCELED') {
            setError(fromIpcFailure(result));
          }
        }
        await refreshQuery();
      } catch (e) {
        if (!mounted.current) return;
        setError(classifyError(e));
      } finally {
        if (mounted.current) setScanning(false);
      }
    },
    [mounted, refreshQuery],
  );

  useEffect(() => {
    const bridge = tryAppBridge();
    if (!bridge || typeof bridge.listArchiveRoots !== 'function') return;
    let cancelled = false;

    const offProgress = bridge.onArchiveScanProgress?.((progress) => {
      if (!mounted.current) return;
      setScanProgress(progress);
      if (progress.phase === 'scanning') {
        setScanning(true);
      } else {
        setScanning(false);
      }
    });

    void (async () => {
      try {
        const initialRoots = await bridge.listArchiveRoots();
        if (cancelled || !mounted.current) return;
        rootsRef.current = initialRoots;
        setRoots(initialRoots);
        if (initialRoots.length > 0) {
          onInitialRootsRef.current?.();
          await refreshQuery(viewportBboxRef.current, initialRoots);
          if (!cancelled && mounted.current) {
            void runScan();
          }
        }
      } catch (e) {
        if (!cancelled && mounted.current) {
          setError(classifyError(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      offProgress?.();
    };
  }, [mounted, refreshQuery, runScan]);

  const addFolder = useCallback(async (): Promise<boolean> => {
    const bridge = tryAppBridge();
    if (!bridge || typeof bridge.pickArchiveFolder !== 'function') return false;
    setError(null);
    try {
      const result = await bridge.pickArchiveFolder();
      if (!mounted.current) return false;
      if (!result.ok) {
        if (!result.canceled) setError(fromIpcFailure(result));
        return false;
      }
      rootsRef.current = result.roots;
      setRoots(result.roots);
      void runScan([result.root]);
      return true;
    } catch (e) {
      if (mounted.current) setError(classifyError(e));
      return false;
    }
  }, [mounted, runScan]);

  const removeFolder = useCallback(
    async (dir: string): Promise<void> => {
      const bridge = tryAppBridge();
      if (!bridge || typeof bridge.removeArchiveRoot !== 'function') return;
      setError(null);
      try {
        const result = await bridge.removeArchiveRoot(dir);
        if (!mounted.current) return;
        if (!result.ok) {
          setError(fromIpcFailure(result));
          return;
        }
        rootsRef.current = result.roots;
        setRoots(result.roots);
        clearPointQuery();
        const nextFilters =
          filtersRef.current.folderRoot === dir
            ? { ...filtersRef.current, folderRoot: '' }
            : filtersRef.current;
        if (nextFilters !== filtersRef.current) {
          filtersRef.current = nextFilters;
          setFiltersState(nextFilters);
        }
        await refreshQuery(viewportBboxRef.current, result.roots, nextFilters);
      } catch (e) {
        if (mounted.current) setError(classifyError(e));
      }
    },
    [clearPointQuery, mounted, refreshQuery],
  );

  const rescan = useCallback(async (): Promise<void> => {
    await runScan();
  }, [runScan]);

  const cancelScan = useCallback(async (): Promise<void> => {
    const bridge = tryAppBridge();
    if (!bridge || typeof bridge.cancelArchiveScan !== 'function') return;
    try {
      const result = await bridge.cancelArchiveScan();
      if (mounted.current && !result.ok) {
        setError(fromIpcFailure(result));
      }
    } catch (e) {
      if (mounted.current) setError(classifyError(e));
    }
  }, [mounted]);

  const revealClip = useCallback(
    async (clipPath: string): Promise<void> => {
      const bridge = tryAppBridge();
      if (!bridge || typeof bridge.revealArchiveClip !== 'function') return;
      setError(null);
      try {
        const result = await bridge.revealArchiveClip(clipPath);
        if (mounted.current && !result.ok) {
          setError(fromIpcFailure(result));
        }
      } catch (e) {
        if (mounted.current) setError(classifyError(e));
      }
    },
    [mounted],
  );

  const pruneOffline = useCallback(async (): Promise<number | null> => {
    const bridge = tryAppBridge();
    if (!bridge || typeof bridge.pruneArchiveOffline !== 'function') return null;
    setPruning(true);
    setError(null);
    try {
      const result = await bridge.pruneArchiveOffline();
      if (!mounted.current) return null;
      if (!result.ok) {
        setError(fromIpcFailure(result));
        return null;
      }
      setLastPrunedCount(result.removed);
      if (result.removed > 0) clearPointQuery();
      await refreshQuery();
      return result.removed;
    } catch (e) {
      if (mounted.current) setError(classifyError(e));
      return null;
    } finally {
      if (mounted.current) setPruning(false);
    }
  }, [clearPointQuery, mounted, refreshQuery]);

  const dismissPruneStatus = useCallback(() => setLastPrunedCount(null), []);
  const dismissError = useCallback(() => setError(null), []);

  const activeFilterCount = useMemo(() => countActiveArchiveFilters(filters), [filters]);
  const activeQueryFilters = useMemo(
    () => buildArchiveQueryFilters(filters, viewportBbox),
    [filters, viewportBbox],
  );

  return {
    roots,
    offlineRoots,
    flights,
    availableFlightIds,
    totalCount,
    offlineCount,
    scanning,
    pruning,
    lastPrunedCount,
    scanProgress,
    error,
    viewportBbox,
    pointHits,
    pointQueryCoord,
    pointQueryLoading,
    pointQueryActive,
    filters,
    activeFilterCount,
    activeQueryFilters,
    setViewportBbox,
    setPointQueryActive,
    togglePointQuery,
    queryAtPoint,
    clearPointQuery,
    setFilters,
    clearFilters,
    addFolder,
    removeFolder,
    rescan,
    cancelScan,
    revealClip,
    pruneOffline,
    dismissPruneStatus,
    dismissError,
  };
}
