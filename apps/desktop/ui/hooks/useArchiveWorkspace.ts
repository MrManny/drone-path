'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { classifyError, fromIpcFailure } from '../../shared/errors.js';
import type { StructuredError } from '../../shared/errors.js';
import type { ArchiveFlightDto, ArchiveScanProgress } from '../../shared/ipc.js';
import { tryAppBridge } from '../lib/backend.js';
import { useMountedRef } from './useMountedRef.js';

export interface ArchiveWorkspaceState {
  roots: string[];
  offlineRoots: ReadonlySet<string>;
  flights: ArchiveFlightDto[];
  totalCount: number;
  offlineCount: number;
  scanning: boolean;
  pruning: boolean;
  lastPrunedCount: number | null;
  scanProgress: ArchiveScanProgress | null;
  error: StructuredError | null;
  addFolder: () => Promise<boolean>;
  removeFolder: (dir: string) => Promise<void>;
  rescan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  pruneOffline: () => Promise<number | null>;
  dismissPruneStatus: () => void;
  dismissError: () => void;
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
  const [totalCount, setTotalCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [lastPrunedCount, setLastPrunedCount] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<ArchiveScanProgress | null>(null);
  const [error, setError] = useState<StructuredError | null>(null);

  const mounted = useMountedRef();
  const rootsRef = useRef(roots);
  useLayoutEffect(() => {
    rootsRef.current = roots;
  }, [roots]);
  const onInitialRootsRef = useRef(onInitialRoots);
  useLayoutEffect(() => {
    onInitialRootsRef.current = onInitialRoots;
  }, [onInitialRoots]);

  const refreshQuery = useCallback(async (nextRoots?: readonly string[]) => {
    const bridge = tryAppBridge();
    if (!bridge || typeof bridge.queryArchive !== 'function') return;
    try {
      const result = await bridge.queryArchive();
      if (!mounted.current) return;
      const activeRoots = nextRoots ?? rootsRef.current;
      setFlights(result.flights);
      setTotalCount(result.totalCount);
      setOfflineCount(result.offlineCount);
      setOfflineRoots(computeOfflineRoots(activeRoots, result.flights, result.offlineRoots));
    } catch (e) {
      if (!mounted.current) return;
      setError(classifyError(e));
    }
  }, [mounted]);

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
          await refreshQuery(initialRoots);
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
        await refreshQuery(result.roots);
      } catch (e) {
        if (mounted.current) setError(classifyError(e));
      }
    },
    [mounted, refreshQuery],
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
      await refreshQuery();
      return result.removed;
    } catch (e) {
      if (mounted.current) setError(classifyError(e));
      return null;
    } finally {
      if (mounted.current) setPruning(false);
    }
  }, [mounted, refreshQuery]);

  const dismissPruneStatus = useCallback(() => setLastPrunedCount(null), []);
  const dismissError = useCallback(() => setError(null), []);

  return {
    roots,
    offlineRoots,
    flights,
    totalCount,
    offlineCount,
    scanning,
    pruning,
    lastPrunedCount,
    scanProgress,
    error,
    addFolder,
    removeFolder,
    rescan,
    cancelScan,
    pruneOffline,
    dismissPruneStatus,
    dismissError,
  };
}
