// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import type { Scene } from 'drone-path-engine/renderer/scene';
import type {
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

vi.mock('leaflet', () => ({ default: {} }));

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
    findArchiveAtPoint: vi.fn(async () => []),
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
});
