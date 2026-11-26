// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import type { Scene } from 'drone-path-engine/renderer/scene';
import type {
  ArchiveNearHit,
  ArchivePickFolderResult,
  ArchivePruneOfflineResult,
  ArchiveQueryFilters,
  ArchiveQueryResult,
  ArchiveScanProgress,
  ArchiveScanResult,
  IpcAck,
  PickOutputResult,
  PickResult,
} from '../../shared/ipc.js';
import Page from '../../ui/app/page.js';
import {
  DEFAULT_ARCHIVE_FILTERS,
  buildArchiveQueryFilters,
  countActiveArchiveFilters,
} from '../../ui/hooks/useArchiveWorkspace.js';
import { SESSION, installRafStub, installResizeObserverStub } from './harness.js';

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { createFakeScene, delayedMapIslandMock } = await import('./harness.js');
  return delayedMapIslandMock(createFakeScene());
});

vi.mock('drone-path-engine/renderer/boot', async () => {
  const { createFakeScene } = await import('./harness.js');
  return {
    bootScene: (): Scene => createFakeScene(),
  };
});

const workspaceLeafletMock = vi.hoisted(() => {
  type Handler = (ev?: unknown) => void;
  let zoomLevel = 13;
  let currentCenter = { lat: 46.6, lng: 14.2 };
  const mapHandlers = new Map<string, Handler[]>();
  const fakeMap = {
    fitBounds: vi.fn(),
    setView: vi.fn((center: [number, number], z: number) => {
      currentCenter = { lat: center[0], lng: center[1] };
      zoomLevel = z;
    }),
    getCenter: vi.fn(() => currentCenter),
    getZoom: vi.fn(() => zoomLevel),
    getBounds: vi.fn(() => ({
      getSouthWest: () => ({ lat: 46.5, lng: 14.1 }),
      getNorthEast: () => ({ lat: 46.7, lng: 14.3 }),
    })),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    invalidateSize: vi.fn(),
    on: vi.fn((ev: string, fn: Handler) => {
      const list = mapHandlers.get(ev) ?? [];
      list.push(fn);
      mapHandlers.set(ev, list);
    }),
    remove: vi.fn(),
  };
  const makeLayer = () => {
    const handlers = new Map<string, Handler[]>();
    const layer = {
      on: (ev: string, fn: Handler) => {
        const list = handlers.get(ev) ?? [];
        list.push(fn);
        handlers.set(ev, list);
        return layer;
      },
      trigger: (ev: string, evData?: unknown) => {
        for (const fn of handlers.get(ev) ?? []) fn(evData);
      },
      addTo: () => layer,
      remove: vi.fn(),
      setStyle: vi.fn(),
      bringToFront: vi.fn(),
      bindTooltip: () => layer,
    };
    return layer;
  };
  const polylines: ReturnType<typeof makeLayer>[] = [];
  const mapFn = vi.fn(() => fakeMap);
  return {
    L: {
      map: mapFn,
      canvas: vi.fn(() => ({})),
      tileLayer: vi.fn(() => ({ addTo: vi.fn(), remove: vi.fn() })),
      layerGroup: vi.fn(() => {
        const group = {
          addTo: vi.fn(() => group),
          clearLayers: vi.fn(() => {
            polylines.length = 0;
          }),
        };
        return group;
      }),
      latLngBounds: vi.fn((sw: [number, number], ne: [number, number]) => ({
        _southWest: { lat: sw[0], lng: sw[1] },
        _northEast: { lat: ne[0], lng: ne[1] },
      })),
      polyline: vi.fn(() => {
        const layer = makeLayer();
        polylines.push(layer);
        return layer;
      }),
      circleMarker: vi.fn(() => makeLayer()),
      DomEvent: { stopPropagation: vi.fn() },
    },
    fakeMap,
    polylines,
    setViewState(center: { lat: number; lng: number }, zoom: number) {
      currentCenter = center;
      zoomLevel = zoom;
    },
    triggerMap(ev: string, evData?: unknown) {
      for (const fn of mapHandlers.get(ev) ?? []) fn(evData);
    },
    reset() {
      zoomLevel = 13;
      currentCenter = { lat: 46.6, lng: 14.2 };
      mapHandlers.clear();
      polylines.length = 0;
      mapFn.mockClear();
      fakeMap.fitBounds.mockClear();
      fakeMap.setView.mockClear();
      fakeMap.getCenter.mockClear();
      fakeMap.getZoom.mockClear();
    },
  };
});

vi.mock('leaflet', () => ({ default: workspaceLeafletMock.L }));

vi.mock('../../ui/components/ExportPreview.js', async () => {
  const { stubExportPreviewMock } = await import('./harness.js');
  return stubExportPreviewMock();
});

const SAMPLE_CLIP_PATH = 'E:\\Drone\\Flights\\DJI_0001.MP4';
const SAMPLE_OFFLINE_PATH = 'E:\\Drone\\Flights\\DJI_0002.MP4';
const SAMPLE_POSTER_ID = '0123456789abcdef0123456789abcdef';

const SAMPLE_QUERY: ArchiveQueryResult = {
  totalCount: 2,
  offlineCount: 1,
  flights: [
    {
      flightId: 'flight-1',
      clips: [
        {
          path: SAMPLE_CLIP_PATH,
          size: 1024,
          mtimeMs: 1000,
          status: 'ok',
          availability: 'online',
          posterId: SAMPLE_POSTER_ID,
          video: {
            fps: { num: 30, den: 1, value: 30, str: '30' },
            frames: 90,
            width: 1920,
            height: 1080,
            durationSec: 3,
          },
          cameraCreationTime: '2026-01-01T10:00:00Z',
          telemetry: {
            source: 'srt',
            method: 'srt-cues',
            fixCount: 3,
            noLock: 0,
            trackDistanceM: 120,
          },
          bbox: { minLat: 46.6, maxLat: 46.61, minLon: 14.2, maxLon: 14.21 },
          track: [[{ lat: 46.6, lon: 14.2, tSec: 0 }]],
          error: null,
          splitFromKey: null,
        },
        {
          path: SAMPLE_OFFLINE_PATH,
          size: 2048,
          mtimeMs: 2000,
          status: 'ok',
          availability: 'offline',
          video: {
            fps: { num: 30, den: 1, value: 30, str: '30' },
            frames: 150,
            width: 1920,
            height: 1080,
            durationSec: 5,
          },
          cameraCreationTime: '2026-01-01T10:05:00Z',
          telemetry: null,
          bbox: null,
          track: [],
          error: null,
          splitFromKey: null,
        },
      ],
    },
  ],
};

function installArchiveBridge(options: {
  initialRoots?: string[];
  queryResult?: ArchiveQueryResult;
  scanResult?: ArchiveScanResult;
  pruneResult?: ArchivePruneOfflineResult;
  pointHits?: ArchiveNearHit[];
} = {}) {
  let roots = [...(options.initialRoots ?? [])];
  let progressListener: ((progress: ArchiveScanProgress) => void) | undefined;

  const bridge = {
    getLanguage: vi.fn(async () => ({ preference: null as string | null, locale: 'en' })),
    saveLanguage: vi.fn(async (preference: string | null) => ({
      ok: true,
      preference,
      locale: preference ?? 'en',
    })),
    getSettings: vi.fn(async () => DEFAULT_CONFIG),
    saveSettings: vi.fn(async () => ({ ok: true })),
    getSession: vi.fn(async () => SESSION),
    pickRecording: vi.fn(async (): Promise<PickResult> => ({ ok: false, canceled: true })),
    onPreparing: vi.fn(() => () => {}),
    onPrepareProgress: vi.fn(() => () => {}),
    onUpdateReady: vi.fn(() => () => {}),
    onUpdateRestartFailed: vi.fn(() => () => {}),
    getUpdateState: vi.fn(async () => ({ ready: false })),
    restartToUpdate: vi.fn(async (): Promise<IpcAck> => ({ ok: true })),
    pickExportOutput: vi.fn(async (): Promise<PickOutputResult> => ({ ok: false, canceled: true })),
    startExport: vi.fn(async (): Promise<IpcAck> => ({ ok: true })),
    pickTrackOutput: vi.fn(async (): Promise<PickOutputResult> => ({ ok: false, canceled: true })),
    saveTrack: vi.fn(async (): Promise<IpcAck> => ({ ok: true })),
    closeWindow: vi.fn(async () => {}),
    listArchiveRoots: vi.fn(async () => [...roots]),
    pickArchiveFolder: vi.fn(async (): Promise<ArchivePickFolderResult> => {
      const added = 'E:\\Drone\\Added';
      roots = [...roots, added];
      return { ok: true, root: added, roots: [...roots] };
    }),
    removeArchiveRoot: vi.fn(async (dir: string) => {
      roots = roots.filter((r) => r !== dir);
      return { ok: true as const, roots: [...roots] };
    }),
    scanArchive: vi.fn(async (): Promise<ArchiveScanResult> => options.scanResult ?? { ok: true, scanned: 2 }),
    cancelArchiveScan: vi.fn(async (): Promise<IpcAck> => ({ ok: true })),
    queryArchive: vi.fn(async (_filters?: ArchiveQueryFilters) => options.queryResult ?? SAMPLE_QUERY),
    findArchiveAtPoint: vi.fn(async (): Promise<ArchiveNearHit[]> => options.pointHits ?? []),
    openArchiveClip: vi.fn(async (): Promise<PickResult> => ({ ok: true })),
    revealArchiveClip: vi.fn(async (): Promise<IpcAck> => ({ ok: true })),
    pickArchiveExportOutput: vi.fn(
      async (): Promise<PickOutputResult> => ({ ok: true, path: 'E:\\Drone\\archive.html' }),
    ),
    exportArchive: vi.fn(async (): Promise<IpcAck> => ({ ok: true })),
    revealExportOutput: vi.fn(async (): Promise<IpcAck> => ({ ok: true })),
    pruneArchiveOffline: vi.fn(
      async (): Promise<ArchivePruneOfflineResult> => options.pruneResult ?? { ok: true, removed: 1 },
    ),
    onArchiveScanProgress: vi.fn((cb: (progress: ArchiveScanProgress) => void) => {
      progressListener = cb;
      return () => {
        progressListener = undefined;
      };
    }),
  };
  (window as { dronepath?: unknown }).dronepath = bridge;
  return {
    bridge,
    emitProgress(progress: ArchiveScanProgress) {
      act(() => {
        progressListener?.(progress);
      });
    },
  };
}

beforeEach(() => {
  workspaceLeafletMock.reset();
  installRafStub();
  installResizeObserverStub();
});

afterEach(() => {
  cleanup();
  delete (window as { dronepath?: unknown }).dronepath;
});

describe('Archive workspace and mode switch', () => {
  it('stays in EmptyWorkspace when no watched folders exist at launch', async () => {
    const { bridge } = installArchiveBridge({ initialRoots: [] });
    render(<Page />);
    await waitFor(() => expect(bridge.listArchiveRoots).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Open…' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Workspace mode' })).toBeNull();
    expect(bridge.scanArchive).not.toHaveBeenCalled();
  });

  it('opens directly into Archive mode and starts a background scan when watched folders exist', async () => {
    const { bridge } = installArchiveBridge({ initialRoots: ['E:\\Drone\\Flights'] });
    render(<Page />);

    await waitFor(() => expect(screen.getByText('Watched folders')).toBeTruthy());
    expect(bridge.scanArchive).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2 recordings')).toBeTruthy();
    expect(screen.getByText(/1 offline/)).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();

    const offlineButton = screen.getByRole<HTMLButtonElement>('button', {
      name: 'DJI_0002.MP4 (offline)',
    });
    expect(offlineButton.disabled).toBe(true);
    expect(offlineButton.className).toContain('archive-clip-row-offline');
    expect(within(offlineButton).getByText('0:05')).toBeTruthy();
    fireEvent.click(offlineButton);
    expect(bridge.openArchiveClip).not.toHaveBeenCalled();

    const modeGroup = screen.getByRole('group', { name: 'Workspace mode' });
    expect(within(modeGroup).getByRole('button', { name: 'Archive' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(modeGroup).getByRole('button', { name: 'Review' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('opens an archive clip directly into Review and preserves Archive state across mode switches', async () => {
    const { bridge } = installArchiveBridge({ initialRoots: ['E:\\Drone\\Flights'] });
    render(<Page />);

    const clipButton = await screen.findByRole('button', { name: 'Open DJI_0001.MP4 in Review' });
    fireEvent.click(clipButton);

    await waitFor(() => expect(document.querySelector('.pane-video video')).not.toBeNull());
    expect(bridge.openArchiveClip).toHaveBeenCalledWith({
      path: SAMPLE_CLIP_PATH,
      settings: expect.objectContaining({ zoom: 0 }),
    });

    const modeGroup = screen.getByRole('group', { name: 'Workspace mode' });
    expect(within(modeGroup).getByRole('button', { name: 'Review' }).getAttribute('aria-pressed')).toBe('true');

    // Switch back to Archive and verify state is preserved in memory without re-querying.
    fireEvent.click(within(modeGroup).getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('button', { name: 'Open DJI_0001.MP4 in Review' })).toBeTruthy();
    expect(bridge.listArchiveRoots).toHaveBeenCalledTimes(1);

    // Switch back to Review and verify loaded recording is still present.
    fireEvent.click(within(screen.getByRole('group', { name: 'Workspace mode' })).getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(document.querySelector('.pane-video video')).not.toBeNull());
  });

  it('supports File -> Open folder…, rescanning, canceling, and removing watched folders', async () => {
    const { bridge, emitProgress } = installArchiveBridge({
      initialRoots: [],
      queryResult: { flights: [], totalCount: 0, offlineCount: 0 },
    });
    render(<Page />);
    await waitFor(() => expect(bridge.listArchiveRoots).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Open folder…' }));

    await waitFor(() => expect(screen.getByText('Watched folders')).toBeTruthy());
    expect(bridge.pickArchiveFolder).toHaveBeenCalledTimes(1);
    expect(bridge.scanArchive).toHaveBeenCalledWith(['E:\\Drone\\Added']);

    emitProgress({
      phase: 'scanning',
      scanned: 1,
      currentPath: 'E:\\Drone\\Added\\DJI_0010.MP4',
      status: 'running',
    });
    expect(screen.getByRole('status').textContent).toBe('Scanning… 1 · DJI_0010.MP4');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(bridge.cancelArchiveScan).toHaveBeenCalledTimes(1);

    emitProgress({ phase: 'canceled', scanned: 1, status: 'canceled' });
    expect(screen.getByRole('status').textContent).toBe('Scan canceled.');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle watched folders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Added' }));
    await waitFor(() => expect(bridge.removeArchiveRoot).toHaveBeenCalledWith('E:\\Drone\\Added'));
  });

  it('renders the master map region and supports keyboard clip navigation and style switching', async () => {
    const twoOnlineQuery: ArchiveQueryResult = {
      totalCount: 2,
      offlineCount: 0,
      flights: [
        {
          flightId: 'flight-1',
          clips: [
            SAMPLE_QUERY.flights[0].clips[0],
            {
              ...SAMPLE_QUERY.flights[0].clips[0],
              path: SAMPLE_OFFLINE_PATH,
            },
          ],
        },
      ],
    };
    const { bridge } = installArchiveBridge({
      initialRoots: ['E:\\Drone\\Flights'],
      queryResult: twoOnlineQuery,
    });
    render(<Page />);

    await screen.findByRole('region', { name: 'Archive flight map' });
    const firstClip = await screen.findByRole('button', { name: 'Open DJI_0001.MP4 in Review' });
    const secondClip = screen.getByRole('button', { name: 'Open DJI_0002.MP4 in Review' });

    act(() => {
      firstClip.focus();
    });
    expect(firstClip.getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(firstClip, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(secondClip);
    expect(secondClip.getAttribute('data-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Topographic' }));
    expect(bridge.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ style: 'topo' }));
  });

  it('marks offline watched folders and gates missing-clip pruning behind confirmation', async () => {
    const offlineRoot = 'F:\\DroneSD';
    const offlineOnlyQuery: ArchiveQueryResult = {
      totalCount: 2,
      offlineCount: 1,
      offlineRoots: [offlineRoot],
      flights: [
        {
          flightId: 'flight-1',
          clips: [
            SAMPLE_QUERY.flights[0].clips[0],
            {
              ...SAMPLE_QUERY.flights[0].clips[1],
              path: 'F:\\DroneSD\\DJI_0002.MP4',
            },
          ],
        },
      ],
    };
    const { bridge } = installArchiveBridge({
      initialRoots: ['E:\\Drone\\Flights', offlineRoot],
      queryResult: offlineOnlyQuery,
      pruneResult: { ok: true, removed: 1 },
    });
    render(<Page />);

    const toggleFolders = await screen.findByRole('button', { name: 'Toggle watched folders' });
    fireEvent.click(toggleFolders);
    await waitFor(() => expect(screen.getByText('DroneSD')).toBeTruthy());
    const offlineFolderRow = screen.getByText('DroneSD').closest('li') as HTMLElement;
    expect(offlineFolderRow.className).toContain('archive-folder-row-offline');
    expect(within(offlineFolderRow).getByText('Offline')).toBeTruthy();
    expect(within(offlineFolderRow).getByRole<HTMLButtonElement>('button', { name: 'Remove DroneSD' }).disabled).toBe(false);

    const pruneTrigger = screen.getByRole<HTMLButtonElement>('button', { name: 'Remove missing clips…' });
    await waitFor(() => expect(pruneTrigger.disabled).toBe(false));
    fireEvent.click(pruneTrigger);

    const dialog = screen.getByRole('dialog', { name: 'Remove missing clips' });
    expect(within(dialog).getByText(/Remove 1 offline clip from the archive\?/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Remove missing clips' })).toBeNull();
    expect(bridge.pruneArchiveOffline).not.toHaveBeenCalled();

    fireEvent.click(pruneTrigger);
    const reopenedDialog = screen.getByRole('dialog', { name: 'Remove missing clips' });
    bridge.queryArchive.mockResolvedValueOnce({
      totalCount: 1,
      offlineCount: 0,
      flights: [
        {
          flightId: 'flight-1',
          clips: [SAMPLE_QUERY.flights[0].clips[0]],
        },
      ],
    });
    fireEvent.click(within(reopenedDialog).getByRole('button', { name: 'Remove missing clips' }));

    await waitFor(() => expect(bridge.pruneArchiveOffline).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Removed 1 missing clip from the archive.')).toBeTruthy());
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove missing clips…' }).disabled).toBe(true);
  });

  it('queries point matches from ground click, opens clip at seekSec, and preserves point state across switches', async () => {
    const pointHits: ArchiveNearHit[] = [
      {
        clip: SAMPLE_QUERY.flights[0].clips[0],
        tSec: 2,
        distanceM: 0,
        matchType: 'gaze',
      },
      {
        clip: SAMPLE_QUERY.flights[0].clips[1],
        tSec: 4,
        distanceM: 15,
        matchType: 'track',
      },
    ];
    const { bridge } = installArchiveBridge({
      initialRoots: ['E:\\Drone\\Flights'],
      pointHits,
    });
    render(<Page />);

    const whatFilmedBtn = await screen.findByRole('button', { name: 'What filmed here?' });
    fireEvent.click(whatFilmedBtn);
    expect(whatFilmedBtn.getAttribute('aria-pressed')).toBe('true');

    await waitFor(() => expect(workspaceLeafletMock.L.map).toHaveBeenCalledTimes(1));
    act(() => {
      workspaceLeafletMock.triggerMap('click', { latlng: { lat: 46.601, lng: 14.201 } });
    });

    await waitFor(() =>
      expect(bridge.findArchiveAtPoint).toHaveBeenCalledWith(
        { lat: 46.601, lon: 14.201 },
        expect.any(Number),
        true,
      ),
    );

    const popover = await screen.findByRole('region', { name: 'Clips at selected point' });
    expect(within(popover).getByText('Camera view')).toBeTruthy();
    expect(within(popover).getByText('Track')).toBeTruthy();
    expect(within(popover).getByText('Offline')).toBeTruthy();
    expect(
      within(popover).getByRole<HTMLButtonElement>('button', {
        name: 'DJI_0002.MP4 at 0:04 (offline)',
      }).disabled,
    ).toBe(true);

    fireEvent.click(
      within(popover).getByRole('button', { name: 'Open DJI_0001.MP4 at 0:02 in Review' }),
    );
    await waitFor(() => expect(document.querySelector('.pane-video video')).not.toBeNull());
    expect(bridge.openArchiveClip).toHaveBeenCalledWith({
      path: SAMPLE_CLIP_PATH,
      settings: expect.objectContaining({ zoom: 0 }),
      seekSec: 2,
    });

    // Switch back to Archive and verify point-query state is preserved in memory.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Workspace mode' })).getByRole('button', {
        name: 'Archive',
      }),
    );
    expect(screen.getByRole('region', { name: 'Clips at selected point' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'What filmed here?' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shows non-blocking empty feedback for ground clicks with no matches and dismisses cleanly', async () => {
    const { bridge } = installArchiveBridge({
      initialRoots: ['E:\\Drone\\Flights'],
      pointHits: [],
    });
    render(<Page />);

    const whatFilmedBtn = await screen.findByRole('button', { name: 'What filmed here?' });
    fireEvent.click(whatFilmedBtn);

    await waitFor(() => expect(workspaceLeafletMock.L.map).toHaveBeenCalledTimes(1));
    act(() => {
      workspaceLeafletMock.triggerMap('click', { latlng: { lat: 46.62, lng: 14.22 } });
    });

    await waitFor(() => expect(bridge.findArchiveAtPoint).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('No clips passed near or filmed this spot.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Clips at selected point' })).toBeNull();
  });

  it('surfaces an error notice if findArchiveAtPoint fails', async () => {
    const { bridge } = installArchiveBridge({ initialRoots: ['E:\\Drone\\Flights'] });
    bridge.findArchiveAtPoint.mockRejectedValueOnce(new Error('archive query failed'));
    render(<Page />);

    fireEvent.click(await screen.findByRole('button', { name: 'What filmed here?' }));
    await waitFor(() => expect(workspaceLeafletMock.L.map).toHaveBeenCalledTimes(1));
    act(() => {
      workspaceLeafletMock.triggerMap('click', { latlng: { lat: 46.62, lng: 14.22 } });
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Clips at selected point' })).toBeNull();
  });

  it('renders lazy clip posters with error fallback and wires Reveal in folder', async () => {
    const { bridge } = installArchiveBridge({ initialRoots: ['E:\\Drone\\Flights'] });
    render(<Page />);

    const openOnline = await screen.findByRole('button', { name: 'Open DJI_0001.MP4 in Review' });
    const img = openOnline.querySelector<HTMLImageElement>('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('loading')).toBe('lazy');
    expect(img!.getAttribute('src')).toBe(`app://bundle/archive/poster/${SAMPLE_POSTER_ID}`);

    fireEvent.error(img!);
    expect(openOnline.querySelector('img')).toBeNull();
    expect(openOnline.querySelector('.archive-clip-poster-fallback')).not.toBeNull();

    const revealOnline = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Reveal DJI_0001.MP4 in folder',
    });
    const revealOffline = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Reveal DJI_0002.MP4 in folder',
    });
    expect(revealOnline.disabled).toBe(false);
    expect(revealOffline.disabled).toBe(true);

    fireEvent.click(revealOnline);
    await waitFor(() => expect(bridge.revealArchiveClip).toHaveBeenCalledWith(SAMPLE_CLIP_PATH));
  });

  it('toggles the collapsible filter rail, queries with filters and viewport sync, and clears filters', async () => {
    const { bridge } = installArchiveBridge({ initialRoots: ['E:\\Drone\\Flights'] });
    render(<Page />);

    await screen.findByRole('button', { name: 'Open DJI_0001.MP4 in Review' });
    const initialQueries = bridge.queryArchive.mock.calls.length;

    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const rail = screen.getByRole('region', { name: 'Archive filters' });
    fireEvent.change(within(rail).getByLabelText('From date'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(within(rail).getByLabelText('To date'), {
      target: { value: '2026-01-02' },
    });
    fireEvent.change(within(rail).getByLabelText('Folder'), {
      target: { value: 'E:\\Drone\\Flights' },
    });
    fireEvent.change(within(rail).getByLabelText('Flight'), {
      target: { value: 'flight-1' },
    });
    fireEvent.change(within(rail).getByLabelText('Min distance'), {
      target: { value: '50' },
    });
    fireEvent.change(within(rail).getByLabelText('Shot type'), {
      target: { value: 'orbit' },
    });
    fireEvent.change(within(rail).getByLabelText('Min smoothness'), {
      target: { value: '0.6' },
    });

    await waitFor(() => expect(bridge.queryArchive.mock.calls.length).toBeGreaterThan(initialQueries));
    const lastFilterCall = bridge.queryArchive.mock.calls.at(-1)?.[0];
    expect(lastFilterCall).toEqual({
      afterMs: Date.parse('2026-01-01T00:00:00.000Z'),
      beforeMs: Date.parse('2026-01-03T00:00:00.000Z'),
      folderRoot: 'E:\\Drone\\Flights',
      flightId: 'flight-1',
      minDistanceM: 50,
      segmentType: 'orbit',
      minSmoothness: 0.6,
    });
    expect(within(toggle).getByText('7')).toBeTruthy();

    fireEvent.click(within(rail).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(within(toggle).queryByText('7')).toBeNull());
    expect(bridge.queryArchive.mock.calls.at(-1)).toEqual([]);
  });

  it('exports the archive via the export modal with format, redaction, gaze, and offline options', async () => {
    const { bridge } = installArchiveBridge({ initialRoots: ['E:\\Drone\\Flights'] });
    render(<Page />);

    await screen.findByRole('button', { name: 'Open DJI_0001.MP4 in Review' });
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));

    const dialog = screen.getByRole('dialog', { name: 'Export archive' });
    fireEvent.change(within(dialog).getByLabelText('Format'), { target: { value: 'html' } });
    fireEvent.click(within(dialog).getByLabelText('Offline map (no online basemaps)'));
    fireEvent.click(within(dialog).getByLabelText('Redact launch area'));
    fireEvent.change(within(dialog).getByLabelText('Radius'), { target: { value: '300' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Export…' }));
    await waitFor(() => expect(bridge.pickArchiveExportOutput).toHaveBeenCalledWith('html'));
    await waitFor(() =>
      expect(bridge.exportArchive).toHaveBeenCalledWith({
        outPath: 'E:\\Drone\\archive.html',
        format: 'html',
        redactLaunchM: 300,
        includeGaze: false,
        offline: true,
      }),
    );

    await screen.findByText('Archive exported.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reveal in folder' }));
    await waitFor(() =>
      expect(bridge.revealExportOutput).toHaveBeenCalledWith({ out: 'E:\\Drone\\archive.html' }),
    );
  });

  it('toggles Only in map view in queryArchive and builds bbox filters cleanly', async () => {
    const bbox = { minLat: 46.5, maxLat: 46.7, minLon: 14.1, maxLon: 14.3 };
    expect(buildArchiveQueryFilters(DEFAULT_ARCHIVE_FILTERS, bbox)).toBeUndefined();
    expect(
      buildArchiveQueryFilters({ ...DEFAULT_ARCHIVE_FILTERS, onlyInMapView: true }, bbox),
    ).toEqual({ bbox });
    expect(
      countActiveArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, onlyInMapView: true }),
    ).toBe(1);

    const { bridge } = installArchiveBridge({ initialRoots: ['E:\\Drone\\Flights'] });
    render(<Page />);

    await screen.findByRole('button', { name: 'Open DJI_0001.MP4 in Review' });
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const rail = screen.getByRole('region', { name: 'Archive filters' });
    const callsBefore = bridge.queryArchive.mock.calls.length;

    fireEvent.click(within(rail).getByLabelText('Only in map view'));
    await waitFor(() => expect(bridge.queryArchive.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.getByRole('button', { name: /Filters/ })).toBeTruthy();
  });

  it('preserves map center/zoom, selected clip, filter rail state, and point-query popover across Review switches', async () => {
    const pointHits: ArchiveNearHit[] = [
      {
        clip: SAMPLE_QUERY.flights[0].clips[0],
        tSec: 12,
        distanceM: 18,
        matchType: 'track',
      },
    ];
    const { bridge } = installArchiveBridge({
      initialRoots: ['E:\\Drone\\Flights'],
      pointHits,
    });
    render(<Page />);

    await waitFor(() => expect(workspaceLeafletMock.L.map).toHaveBeenCalledTimes(1));
    expect(workspaceLeafletMock.fakeMap.fitBounds).toHaveBeenCalledTimes(1);

    const filterToggle = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(filterToggle);
    expect(filterToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: 'Archive filters' })).toBeTruthy();

    const clipButton = await screen.findByRole('button', { name: 'Open DJI_0001.MP4 in Review' });
    fireEvent.focus(clipButton);
    expect(clipButton.getAttribute('data-selected')).toBe('true');

    workspaceLeafletMock.setViewState({ lat: 46.609, lng: 14.209 }, 16);
    act(() => {
      workspaceLeafletMock.triggerMap('moveend');
    });

    fireEvent.click(screen.getByRole('button', { name: 'What filmed here?' }));
    act(() => {
      workspaceLeafletMock.triggerMap('click', { latlng: { lat: 46.602, lng: 14.202 } });
    });

    const popover = await screen.findByRole('region', { name: 'Clips at selected point' });
    expect(within(popover).getByText('Track')).toBeTruthy();
    fireEvent.click(
      within(popover).getByRole('button', { name: 'Open DJI_0001.MP4 at 0:12 in Review' }),
    );
    await waitFor(() => expect(document.querySelector('.pane-video video')).not.toBeNull());
    expect(bridge.openArchiveClip).toHaveBeenCalledWith({
      path: SAMPLE_CLIP_PATH,
      settings: expect.objectContaining({ zoom: 0 }),
      seekSec: 12,
    });

    workspaceLeafletMock.fakeMap.fitBounds.mockClear();
    workspaceLeafletMock.fakeMap.setView.mockClear();

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Workspace mode' })).getByRole('button', {
        name: 'Archive',
      }),
    );

    await waitFor(() => expect(workspaceLeafletMock.L.map).toHaveBeenCalledTimes(2));
    expect(workspaceLeafletMock.fakeMap.setView).toHaveBeenCalledWith([46.609, 14.209], 16);
    expect(workspaceLeafletMock.fakeMap.fitBounds).not.toHaveBeenCalled();

    expect(
      screen.getByRole('button', { name: 'Open DJI_0001.MP4 in Review' }).getAttribute('data-selected'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: 'Archive filters' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Clips at selected point' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'What filmed here?' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('starts with watched folders collapsed when roots exist and expands on toggle', async () => {
    installArchiveBridge({ initialRoots: ['E:\\Drone\\Flights'] });
    render(<Page />);

    const toggle = await screen.findByRole('button', { name: 'Toggle watched folders' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('1 folder · Flights')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Flights' })).toBeNull();
    expect(screen.getByText('· 2 clips')).toBeTruthy();
    expect(screen.getByText('0:08')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('E:\\Drone\\Flights')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Flights' })).toBeTruthy();
  });

  it('clears selectedClipPath only when its watched folder is removed', async () => {
    const { bridge } = installArchiveBridge({
      initialRoots: ['E:\\Drone\\Flights', 'F:\\Drone\\Other'],
    });
    render(<Page />);

    const clipButton = await screen.findByRole('button', { name: 'Open DJI_0001.MP4 in Review' });
    fireEvent.focus(clipButton);
    expect(clipButton.getAttribute('data-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle watched folders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Other' }));
    await waitFor(() => expect(bridge.removeArchiveRoot).toHaveBeenCalledWith('F:\\Drone\\Other'));
    expect(
      screen.getByRole('button', { name: 'Open DJI_0001.MP4 in Review' }).getAttribute('data-selected'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Flights' }));
    await waitFor(() => expect(bridge.removeArchiveRoot).toHaveBeenCalledWith('E:\\Drone\\Flights'));
    expect(
      screen.getByRole('button', { name: 'Open DJI_0001.MP4 in Review' }).getAttribute('data-selected'),
    ).toBeNull();
  });
});
