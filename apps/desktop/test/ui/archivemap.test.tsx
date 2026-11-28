// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArchiveFlightDto, ArchiveNearHit } from '../../shared/ipc.js';
import { ArchiveMap } from '../../ui/components/ArchiveMap.js';
import { installResizeObserverStub } from './harness.js';

const leafletMock = vi.hoisted(() => {
  type Handler = (ev?: unknown) => void;
  interface FakeLayer {
    options: Record<string, unknown>;
    handlers: Map<string, Handler[]>;
    styleHistory: Record<string, unknown>[];
    tooltip?: string;
    on: (ev: string, fn: Handler) => FakeLayer;
    trigger: (ev: string, evData?: unknown) => void;
    addTo: (group: unknown) => FakeLayer;
    remove: () => void;
    setStyle: (opts: Record<string, unknown>) => void;
    bringToFront: () => void;
    bindTooltip: (text: string, opts?: unknown) => FakeLayer;
  }

  function makeLayer(kind: 'polyline' | 'circleMarker', options: Record<string, unknown>): FakeLayer {
    const handlers = new Map<string, Handler[]>();
    const layer: FakeLayer = {
      options,
      handlers,
      styleHistory: [options],
      on(ev, fn) {
        const list = handlers.get(ev) ?? [];
        list.push(fn);
        handlers.set(ev, list);
        return layer;
      },
      trigger(ev, evData) {
        for (const fn of handlers.get(ev) ?? []) fn(evData);
      },
      addTo() {
        return layer;
      },
      remove: vi.fn(),
      setStyle(opts) {
        layer.options = { ...layer.options, ...opts };
        layer.styleHistory.push(opts);
      },
      bringToFront: vi.fn(),
      bindTooltip(text) {
        layer.tooltip = text;
        return layer;
      },
    };
    if (kind === 'polyline') polylines.push(layer);
    else circleMarkers.push(layer);
    return layer;
  }

  let zoomLevel = 13;
  let currentCenter = { lat: 46.6, lng: 14.2 };
  let currentBounds = {
    getSouthWest: () => ({ lat: 46.5, lng: 14.1 }),
    getNorthEast: () => ({ lat: 46.7, lng: 14.3 }),
  };
  interface FakeTileLayer {
    url: string;
    options: Record<string, unknown>;
    handlers: Map<string, Handler[]>;
    on: (ev: string, fn: Handler) => FakeTileLayer;
    off: (ev: string, fn: Handler) => FakeTileLayer;
    trigger: (ev: string, evData?: unknown) => void;
    addTo: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }
  const mapHandlers = new Map<string, Handler[]>();
  const tileLayers: FakeTileLayer[] = [];
  const polylines: FakeLayer[] = [];
  const circleMarkers: FakeLayer[] = [];
  const canvasInstances: Record<string, unknown>[] = [];
  const mapCalls: Record<string, unknown>[] = [];

  const fakeMap = {
    fitBounds: vi.fn((bounds: { _southWest: { lat: number; lng: number }; _northEast: { lat: number; lng: number } }) => {
      currentBounds = {
        getSouthWest: () => bounds._southWest,
        getNorthEast: () => bounds._northEast,
      };
      currentCenter = {
        lat: (bounds._southWest.lat + bounds._northEast.lat) / 2,
        lng: (bounds._southWest.lng + bounds._northEast.lng) / 2,
      };
    }),
    setView: vi.fn((center: [number, number], z: number) => {
      currentCenter = { lat: center[0], lng: center[1] };
      zoomLevel = z;
    }),
    getCenter: vi.fn(() => currentCenter),
    getZoom: vi.fn(() => zoomLevel),
    getBounds: vi.fn(() => currentBounds),
    zoomIn: vi.fn(() => {
      zoomLevel += 1;
      for (const fn of mapHandlers.get('zoomend') ?? []) fn();
    }),
    zoomOut: vi.fn(() => {
      zoomLevel -= 1;
      for (const fn of mapHandlers.get('zoomend') ?? []) fn();
    }),
    invalidateSize: vi.fn(),
    on: vi.fn((ev: string, fn: Handler) => {
      const list = mapHandlers.get(ev) ?? [];
      list.push(fn);
      mapHandlers.set(ev, list);
    }),
    remove: vi.fn(),
  };

  const L = {
    map: vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => {
      mapCalls.push(opts);
      return fakeMap;
    }),
    canvas: vi.fn((opts: Record<string, unknown>) => {
      const renderer = { _canvasOpts: opts };
      canvasInstances.push(renderer);
      return renderer;
    }),
    tileLayer: vi.fn((url: string, options: Record<string, unknown>) => {
      const handlers = new Map<string, Handler[]>();
      const tl: FakeTileLayer = {
        url,
        options,
        handlers,
        on(ev, fn) {
          const list = handlers.get(ev) ?? [];
          list.push(fn);
          handlers.set(ev, list);
          return tl;
        },
        off(ev, fn) {
          const list = handlers.get(ev);
          if (list) {
            handlers.set(
              ev,
              list.filter((entry) => entry !== fn),
            );
          }
          return tl;
        },
        trigger(ev, evData) {
          for (const fn of handlers.get(ev) ?? []) fn(evData);
        },
        addTo: vi.fn(() => tl),
        remove: vi.fn(),
      };
      tileLayers.push(tl);
      return tl;
    }),
    layerGroup: vi.fn(() => {
      const group = {
        addTo: vi.fn(() => group),
        clearLayers: vi.fn(() => {
          polylines.length = 0;
          circleMarkers.length = 0;
        }),
      };
      return group;
    }),
    latLngBounds: vi.fn((sw: [number, number], ne: [number, number]) => ({
      _southWest: { lat: sw[0], lng: sw[1] },
      _northEast: { lat: ne[0], lng: ne[1] },
    })),
    polyline: vi.fn((_pts: [number, number][], opts: Record<string, unknown>) => makeLayer('polyline', opts)),
    circleMarker: vi.fn((_pt: [number, number], opts: Record<string, unknown>) =>
      makeLayer('circleMarker', opts),
    ),
    DomEvent: {
      stopPropagation: vi.fn(),
    },
  };

  return {
    L,
    fakeMap,
    tileLayers,
    polylines,
    circleMarkers,
    canvasInstances,
    mapCalls,
    mapHandlers,
    setZoom(z: number) {
      zoomLevel = z;
    },
    setCenter(lat: number, lng: number) {
      currentCenter = { lat, lng };
    },
    triggerMap(ev: string, evData?: unknown) {
      for (const fn of mapHandlers.get(ev) ?? []) fn(evData);
    },
    reset() {
      zoomLevel = 13;
      currentCenter = { lat: 46.6, lng: 14.2 };
      mapHandlers.clear();
      tileLayers.length = 0;
      polylines.length = 0;
      circleMarkers.length = 0;
      canvasInstances.length = 0;
      mapCalls.length = 0;
      vi.clearAllMocks();
    },
  };
});

vi.mock('leaflet', () => ({ default: leafletMock.L }));

const FLIGHTS: ArchiveFlightDto[] = [
  {
    flightId: 'f1',
    clips: [
      {
        path: 'E:\\Flights\\DJI_0001.MP4',
        size: 1000,
        mtimeMs: 1000,
        status: 'ok',
        availability: 'online',
        video: {
          fps: { num: 30, den: 1, value: 30, str: '30' },
          frames: 150,
          width: 1920,
          height: 1080,
          durationSec: 5,
        },
        cameraCreationTime: '2026-01-01T10:00:00Z',
        telemetry: { source: 'srt', method: 'srt-cues', fixCount: 2, noLock: 0, trackDistanceM: 120 },
        bbox: { minLat: 46.6, maxLat: 46.605, minLon: 14.2, maxLon: 14.205 },
        track: [
          [
            { lat: 46.6, lon: 14.2, tSec: 0 },
            { lat: 46.605, lon: 14.205, tSec: 5 },
          ],
        ],
        error: null,
        splitFromKey: null,
      },
      {
        path: 'E:\\Flights\\DJI_0002.MP4',
        size: 1000,
        mtimeMs: 2000,
        status: 'ok',
        availability: 'offline',
        video: {
          fps: { num: 30, den: 1, value: 30, str: '30' },
          frames: 300,
          width: 1920,
          height: 1080,
          durationSec: 10,
        },
        cameraCreationTime: '2026-01-01T10:02:00Z',
        telemetry: { source: 'srt', method: 'srt-cues', fixCount: 2, noLock: 0, trackDistanceM: 250 },
        bbox: { minLat: 46.606, maxLat: 46.61, minLon: 14.206, maxLon: 14.21 },
        track: [
          [
            { lat: 46.606, lon: 14.206, tSec: 0 },
            { lat: 46.61, lon: 14.21, tSec: 10 },
          ],
        ],
        error: null,
        splitFromKey: null,
      },
    ],
  },
];

beforeEach(() => {
  leafletMock.reset();
  installResizeObserverStub();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('ArchiveMap', () => {
  it('initializes Canvas-rendered Leaflet map with tile proxy and style switching', async () => {
    const onStyleChange = vi.fn();
    const { rerender } = render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
        onStyleChange={onStyleChange}
      />,
    );

    await waitFor(() => expect(leafletMock.L.map).toHaveBeenCalledTimes(1));
    expect(leafletMock.mapCalls[0]).toMatchObject({ preferCanvas: true });
    expect(leafletMock.L.canvas).toHaveBeenCalledWith({ padding: 0.5 });
    expect(leafletMock.tileLayers[0].url).toBe('app://bundle/tiles/satellite/{z}/{x}/{y}.png');
    expect(leafletMock.fakeMap.fitBounds).toHaveBeenCalledTimes(1);
    expect(leafletMock.polylines).toHaveLength(2);
    expect(leafletMock.polylines[0].options.renderer).toBe(leafletMock.canvasInstances[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Topographic' }));
    expect(onStyleChange).toHaveBeenCalledWith('topo');

    rerender(
      <ArchiveMap
        flights={FLIGHTS}
        style="topo"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
        onStyleChange={onStyleChange}
      />,
    );
    expect(leafletMock.tileLayers.at(-1)?.url).toBe('app://bundle/tiles/topo/{z}/{x}/{y}.png');
  });

  it('highlights hovered and selected tracks with readout and emits selection', async () => {
    const onSelectClip = vi.fn();
    const onOpenClip = vi.fn();
    const { rerender } = render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={onSelectClip}
        onOpenClip={onOpenClip}
        onViewportChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(leafletMock.polylines).toHaveLength(2));

    act(() => {
      leafletMock.polylines[0].trigger('mouseover');
    });
    expect(screen.getByRole('status').textContent).toContain('DJI_0001.MP4');
    expect(screen.getByRole('status').textContent).toContain('120 m');

    act(() => {
      leafletMock.polylines[0].trigger('click');
    });
    expect(onSelectClip).toHaveBeenCalledWith('E:\\Flights\\DJI_0001.MP4');

    rerender(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={'E:\\Flights\\DJI_0001.MP4'}
        onSelectClip={onSelectClip}
        onOpenClip={onOpenClip}
        onViewportChange={vi.fn()}
      />,
    );
    expect(leafletMock.polylines[0].options.color).toBe('#e87f54');

    fireEvent.click(screen.getByRole('button', { name: 'Open in Review' }));
    expect(onOpenClip).toHaveBeenCalledWith('E:\\Flights\\DJI_0001.MP4');
  });

  it('renders clusters at low zoom and zooms into cluster bounds when clicked', async () => {
    leafletMock.setZoom(8);
    render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(leafletMock.circleMarkers).toHaveLength(1));
    expect(leafletMock.circleMarkers[0].tooltip).toBe('2');
    expect(leafletMock.polylines).toHaveLength(0);

    const beforeFits = leafletMock.fakeMap.fitBounds.mock.calls.length;
    act(() => {
      leafletMock.circleMarkers[0].trigger('click');
    });
    expect(leafletMock.fakeMap.fitBounds.mock.calls.length).toBe(beforeFits + 1);
  });

  it('exposes the point search toggle, prompt, and cancel control in keyboard order', async () => {
    const onToggle = vi.fn();
    render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
        onStyleChange={vi.fn()}
        pointQueryActive
        onTogglePointQuery={onToggle}
      />,
    );

    const canvas = await screen.findByTestId('archive-map-canvas');
    const toggle = screen.getByRole('button', { name: 'What filmed here?' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(canvas.classList.contains('is-point-query')).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Select a point on the map')).toBeTruthy();
    const toolbar = toggle.parentElement!;
    expect([...toolbar.querySelectorAll('button')]).toEqual([
      screen.getByRole('button', { name: 'Satellite' }),
      screen.getByRole('button', { name: 'Topographic' }),
      toggle,
      cancel,
    ]);
    fireEvent.click(cancel);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(toggle);
  });

  it('debounces moveend viewport updates and resets viewport on Fit all', async () => {
    const onViewportChange = vi.fn();
    render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={onViewportChange}
      />,
    );

    await waitFor(() => expect(leafletMock.L.map).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    act(() => {
      leafletMock.triggerMap('moveend');
    });
    expect(onViewportChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onViewportChange).toHaveBeenCalledWith({
      minLat: 46.6,
      maxLat: 46.61,
      minLon: 14.2,
      maxLon: 14.21,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Fit all' }));
    expect(onViewportChange).toHaveBeenLastCalledWith(null);
  });

  it('queries point on track click without resetting view and toggles ground point-query mode', async () => {
    const onSelectClip = vi.fn();
    const onPointQuery = vi.fn();
    const onTogglePointQuery = vi.fn();
    const { rerender } = render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={onSelectClip}
        onViewportChange={vi.fn()}
        pointQueryActive={false}
        onTogglePointQuery={onTogglePointQuery}
        onPointQuery={onPointQuery}
      />,
    );

    await waitFor(() => expect(leafletMock.polylines).toHaveLength(2));
    const fitsBefore = leafletMock.fakeMap.fitBounds.mock.calls.length;

    // Ground click does nothing while point-query mode is off.
    act(() => {
      leafletMock.triggerMap('click', { latlng: { lat: 46.602, lng: 14.202 } });
    });
    expect(onPointQuery).not.toHaveBeenCalled();

    // Track polyline click selects the clip and queries the clicked coordinate.
    act(() => {
      leafletMock.polylines[0].trigger('click', { latlng: { lat: 46.603, lng: 14.203 } });
    });
    expect(onSelectClip).toHaveBeenCalledWith('E:\\Flights\\DJI_0001.MP4');
    expect(onPointQuery).toHaveBeenCalledWith({ lat: 46.603, lon: 14.203 }, expect.any(Number));
    expect(leafletMock.fakeMap.fitBounds.mock.calls.length).toBe(fitsBefore);

    const toggle = screen.getByRole('button', { name: 'What filmed here?' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onTogglePointQuery).toHaveBeenCalledTimes(1);

    rerender(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={onSelectClip}
        onViewportChange={vi.fn()}
        pointQueryActive={true}
        onTogglePointQuery={onTogglePointQuery}
        onPointQuery={onPointQuery}
        pointQueryCoord={{ lat: 46.604, lon: 14.204 }}
        pointHits={[]}
      />,
    );

    expect(screen.getByRole('button', { name: 'What filmed here?' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('archive-map-canvas').className).toContain('is-point-query');
    expect(leafletMock.L.circleMarker).toHaveBeenCalledWith(
      [46.604, 14.204],
      expect.objectContaining({ interactive: false }),
    );
    const focusMarker = leafletMock.circleMarkers.at(-1)!;

    act(() => {
      leafletMock.triggerMap('click', { latlng: { lat: 46.608, lng: 14.208 } });
    });
    expect(onPointQuery).toHaveBeenLastCalledWith({ lat: 46.608, lon: 14.208 }, expect.any(Number));

    rerender(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={onSelectClip}
        onViewportChange={vi.fn()}
        pointQueryActive={true}
        onTogglePointQuery={onTogglePointQuery}
        onPointQuery={onPointQuery}
        pointQueryCoord={null}
        pointHits={null}
      />,
    );
    expect(focusMarker.remove).toHaveBeenCalledTimes(1);
  });

  it('renders ranked track and gaze hits in popover, seeks on click, handles offline hits, and supports empty dismissal', async () => {
    const onOpenClip = vi.fn();
    const onClearPointQuery = vi.fn();
    const hits: ArchiveNearHit[] = [
      {
        clip: FLIGHTS[0].clips[0],
        tSec: 65,
        distanceM: 0,
        matchType: 'gaze',
      },
      {
        clip: {
          ...FLIGHTS[0].clips[0],
          path: 'E:\\Flights\\DJI_0003.MP4',
        },
        tSec: 12,
        distanceM: 42.4,
        matchType: 'track',
      },
      {
        clip: FLIGHTS[0].clips[1],
        tSec: 8,
        distanceM: 18,
        matchType: 'track',
      },
    ];

    const { rerender } = render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onOpenClip={onOpenClip}
        onViewportChange={vi.fn()}
        pointQueryCoord={{ lat: 46.605, lon: 14.205 }}
        pointHits={hits}
        pointQueryLoading={false}
        onClearPointQuery={onClearPointQuery}
      />,
    );

    const popover = await screen.findByRole('region', { name: 'Clips at selected point' });
    expect(popover.textContent).toContain('Camera view');
    expect(popover.textContent).toContain('Track');
    expect(popover.textContent).toContain('1:05');
    expect(popover.textContent).toContain('0:12');
    expect(popover.textContent).toContain('0 m');
    expect(popover.textContent).toContain('42 m');

    const gazeHitBtn = screen.getByRole('button', { name: 'Open DJI_0001.MP4 at 1:05 in Review' });
    fireEvent.click(gazeHitBtn);
    expect(onOpenClip).toHaveBeenCalledWith('E:\\Flights\\DJI_0001.MP4', 65);

    const trackHitBtn = screen.getByRole('button', { name: 'Open DJI_0003.MP4 at 0:12 in Review' });
    fireEvent.click(trackHitBtn);
    expect(onOpenClip).toHaveBeenCalledWith('E:\\Flights\\DJI_0003.MP4', 12);

    const offlineBtn = screen.getByRole<HTMLButtonElement>('button', {
      name: 'DJI_0002.MP4 at 0:08 (offline)',
    });
    expect(offlineBtn.disabled).toBe(true);
    expect(offlineBtn.textContent).toContain('Offline');
    expect(offlineBtn.textContent).toContain('Offline or missing. Reconnect the drive or rescan to open.');

    // Escape closes popover.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClearPointQuery).toHaveBeenCalledTimes(1);

    // Empty hits show non-blocking feedback without clearing map polylines.
    rerender(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onOpenClip={onOpenClip}
        onViewportChange={vi.fn()}
        pointQueryCoord={{ lat: 46.605, lon: 14.205 }}
        pointHits={[]}
        pointQueryLoading={false}
        onClearPointQuery={onClearPointQuery}
      />,
    );
    expect(screen.getByText('No clips passed near or filmed this spot.')).toBeTruthy();
    expect(leafletMock.polylines).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClearPointQuery).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClearPointQuery).toHaveBeenCalledTimes(3);
  });

  it('shows Preparing map… while map initializes or tile layer emits loading and hides it on load', async () => {
    const { rerender } = render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Preparing map…')).toBeTruthy();

    await waitFor(() => expect(leafletMock.tileLayers).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Preparing map…')).toBeNull());

    const satelliteLayer = leafletMock.tileLayers[0];
    act(() => {
      satelliteLayer.trigger('loading');
    });
    expect(screen.getByText('Preparing map…')).toBeTruthy();

    act(() => {
      satelliteLayer.trigger('load');
    });
    expect(screen.queryByText('Preparing map…')).toBeNull();

    // Switching styles while tiles are loading cleans up the previous layer and clears loading.
    act(() => {
      satelliteLayer.trigger('loading');
    });
    expect(screen.getByText('Preparing map…')).toBeTruthy();

    rerender(
      <ArchiveMap
        flights={FLIGHTS}
        style="topo"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
      />,
    );
    expect(satelliteLayer.remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Preparing map…')).toBeNull();

    const topoLayer = leafletMock.tileLayers[1];
    act(() => {
      topoLayer.trigger('loading');
    });
    expect(screen.getByText('Preparing map…')).toBeTruthy();

    act(() => {
      topoLayer.trigger('load');
    });
    expect(screen.queryByText('Preparing map…')).toBeNull();
  });

  it('restores initialMapView via setView without calling fitBounds', async () => {
    const { rerender } = render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
        initialMapView={{ center: { lat: 46.607, lon: 14.208 }, zoom: 16 }}
      />,
    );

    await waitFor(() => expect(leafletMock.L.map).toHaveBeenCalledTimes(1));
    expect(leafletMock.fakeMap.setView).toHaveBeenCalledWith([46.607, 14.208], 16);
    expect(leafletMock.fakeMap.fitBounds).not.toHaveBeenCalled();

    // Updating flights later must not override the restored camera with auto-fit.
    rerender(
      <ArchiveMap
        flights={[
          {
            flightId: 'f2',
            clips: [FLIGHTS[0].clips[0]],
          },
        ]}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
        initialMapView={{ center: { lat: 46.607, lon: 14.208 }, zoom: 16 }}
      />,
    );
    expect(leafletMock.fakeMap.fitBounds).not.toHaveBeenCalled();
  });

  it('reports onMapViewChange on moveend, zoomend, and Fit all', async () => {
    const onMapViewChange = vi.fn();
    render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
        onMapViewChange={onMapViewChange}
      />,
    );

    await waitFor(() => expect(leafletMock.L.map).toHaveBeenCalledTimes(1));

    leafletMock.setCenter(46.612, 194.25);
    leafletMock.setZoom(15);
    act(() => {
      leafletMock.triggerMap('moveend');
    });
    expect(onMapViewChange).toHaveBeenLastCalledWith({
      center: { lat: 46.612, lon: -165.75 },
      zoom: 15,
    });

    act(() => {
      leafletMock.fakeMap.zoomIn();
    });
    expect(onMapViewChange).toHaveBeenLastCalledWith({
      center: { lat: 46.612, lon: -165.75 },
      zoom: 16,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Fit all' }));
    expect(leafletMock.fakeMap.fitBounds).toHaveBeenCalledTimes(2);
    const fittedView = onMapViewChange.mock.calls.at(-1)?.[0] as {
      center: { lat: number; lon: number };
      zoom: number;
    };
    expect(fittedView.center.lat).toBeCloseTo(46.605, 6);
    expect(fittedView.center.lon).toBeCloseTo(14.205, 6);
    expect(fittedView.zoom).toBe(16);
  });

  it('emits onDetailViewportChange at zoom >= 14 and clears below 14', async () => {
    const onDetailViewportChange = vi.fn();
    leafletMock.setZoom(12);
    render(
      <ArchiveMap
        flights={FLIGHTS}
        style="satellite"
        selectedClipPath={null}
        onSelectClip={vi.fn()}
        onViewportChange={vi.fn()}
        onDetailViewportChange={onDetailViewportChange}
      />,
    );

    await waitFor(() => expect(leafletMock.L.map).toHaveBeenCalledTimes(1));
    expect(onDetailViewportChange).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      leafletMock.setZoom(14);
      act(() => {
        leafletMock.triggerMap('zoomend');
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onDetailViewportChange).toHaveBeenLastCalledWith({
        minLat: 46.6,
        maxLat: 46.61,
        minLon: 14.2,
        maxLon: 14.21,
      });

      leafletMock.setZoom(12);
      act(() => {
        leafletMock.triggerMap('zoomend');
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onDetailViewportChange).toHaveBeenLastCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });
});
