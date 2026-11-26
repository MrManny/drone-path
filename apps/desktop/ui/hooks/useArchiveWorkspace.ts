'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { Bbox } from 'drone-path-core/geo';
import { classifyError, fromIpcFailure } from '../../shared/errors.js';
import type { StructuredError } from '../../shared/errors.js';
import type { ArchiveFlightDto, ArchiveScanProgress } from '../../shared/ipc.js';
import { tryAppBridge } from '../lib/backend.js';
import { useMountedRef } from './useMountedRef.js';

export interface ArchiveWorkspaceState {
  roots: string[];
  flights: ArchiveFlightDto[];
  totalCount: number;
  offlineCount: number;
  scanning: boolean;
  scanProgress: ArchiveScanProgress | null;
  error: StructuredError | null;
  viewportBbox: Bbox | null;
  setViewportBbox: (bbox: Bbox | null) => void;
  addFolder: () => Promise<boolean>;
  removeFolder: (dir: string) => Promise<void>;
  rescan: () => Promise<void>;
  cancelScan: () => Promise<void>;
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

export function useArchiveWorkspace(onInitialRoots?: () => void): ArchiveWorkspaceState {
  const [roots, setRoots] = useState<string[]>([]);
  const [flights, setFlights] = useState<ArchiveFlightDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ArchiveScanProgress | null>(null);
  const [error, setError] = useState<StructuredError | null>(null);
  const [viewportBbox, setViewportBboxState] = useState<Bbox | null>(null);

  const mounted = useMountedRef();
  const viewportBboxRef = useRef<Bbox | null>(null);
  const querySeqRef = useRef(0);
  const onInitialRootsRef = useRef(onInitialRoots);
  useLayoutEffect(() => {
    onInitialRootsRef.current = onInitialRoots;
  }, [onInitialRoots]);

  const refreshQuery = useCallback(
    async (bbox: Bbox | null = viewportBboxRef.current) => {
      const bridge = tryAppBridge();
      if (!bridge || typeof bridge.queryArchive !== 'function') return;
      const seq = (querySeqRef.current += 1);
      try {
        const result = await (bbox ? bridge.queryArchive({ bbox }) : bridge.queryArchive());
        if (!mounted.current || querySeqRef.current !== seq) return;
        setFlights(result.flights);
        setTotalCount(result.totalCount);
        setOfflineCount(result.offlineCount);
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
      void refreshQuery(bbox);
    },
    [refreshQuery],
  );

  const runScan = useCallback(
    async (targetRoots?: string[]) => {
      const bridge = tryAppBridge();
      if (!bridge || typeof bridge.scanArchive !== 'function') return;
      setScanning(true);
      setError(null);
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
        setRoots(initialRoots);
        if (initialRoots.length > 0) {
          onInitialRootsRef.current?.();
          await refreshQuery();
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
        setRoots(result.roots);
        await refreshQuery();
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

  const dismissError = useCallback(() => setError(null), []);

  return {
    roots,
    flights,
    totalCount,
    offlineCount,
    scanning,
    scanProgress,
    error,
    viewportBbox,
    setViewportBbox,
    addFolder,
    removeFolder,
    rescan,
    cancelScan,
    dismissError,
  };
}
