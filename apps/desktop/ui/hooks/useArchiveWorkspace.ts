'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
  addFolder: () => Promise<boolean>;
  removeFolder: (dir: string) => Promise<void>;
  rescan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  dismissError: () => void;
}

export function useArchiveWorkspace(onInitialRoots?: () => void): ArchiveWorkspaceState {
  const [roots, setRoots] = useState<string[]>([]);
  const [flights, setFlights] = useState<ArchiveFlightDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ArchiveScanProgress | null>(null);
  const [error, setError] = useState<StructuredError | null>(null);

  const mounted = useMountedRef();
  const onInitialRootsRef = useRef(onInitialRoots);
  useLayoutEffect(() => {
    onInitialRootsRef.current = onInitialRoots;
  }, [onInitialRoots]);

  const refreshQuery = useCallback(async () => {
    const bridge = tryAppBridge();
    if (!bridge || typeof bridge.queryArchive !== 'function') return;
    try {
      const result = await bridge.queryArchive();
      if (!mounted.current) return;
      setFlights(result.flights);
      setTotalCount(result.totalCount);
      setOfflineCount(result.offlineCount);
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
    addFolder,
    removeFolder,
    rescan,
    cancelScan,
    dismissError,
  };
}
