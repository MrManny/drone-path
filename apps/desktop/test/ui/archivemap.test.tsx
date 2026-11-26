// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArchiveFlightDto } from '../../shared/ipc.js';
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
    trigger: (ev: string) => void;
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
      trigger(ev) {
        for (const fn of handlers.get(ev) ?? []) fn();
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
  let currentBounds = {
    getSouthWest: () => ({ lat: 46.5, lng: 14.1 }),
    getNorthEast: () => ({ lat: 46.7, lng: 14.3 }),
  };
  const mapHandlers = new Map<string, Handler[]>();
  const tileLayers: { url: string; options: Record<string, unknown>; remove: ReturnType<typeof vi.fn> }[] = [];
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
    }),
    setView: vi.fn((_center: [number, number], z: number) => {
      zoomLevel = z;
    }),
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
      const tl = {
        url,
        options,
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
    triggerMap(ev: string) {
      for (const fn of mapHandlers.get(ev) ?? []) fn();
    },
    reset() {
      zoomLevel = 13;
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
});
