// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LatLngExpression } from 'leaflet';

import type { LeafletApi, Scene, SceneData } from '../../src/renderer/scene.js';
import { MapIsland } from '../../ui/components/MapIsland.js';
import type { FakeObserver } from './harness.js';
import { flushRaf, installRafStub, installResizeObserverStub } from './harness.js';

const fakeL = vi.hoisted((): LeafletApi => {
  const layer = { addTo: () => {}, remove: () => {} };
  return {
    map: () => ({
      setView: () => {},
      getCenter: () => ({ lat: 46.6, lng: 14.26 }),
      project: (latlng: LatLngExpression) => ({
        x: (Array.isArray(latlng) ? latlng[0] : latlng.lat) * 1000,
        y: (Array.isArray(latlng) ? latlng[1] : latlng.lng) * 1000,
      }),
      invalidateSize: () => {},
      remove: () => {},
    }),
    tileLayer: () => ({ ...layer, on: () => {}, setUrl: () => {} }),
    latLngBounds: () => ({
      getCenter: () => ({ lat: 46.61, lng: 14.26 }),
      getNorthWest: () => ({ lat: 46.62, lng: 14.25 }),
      getSouthEast: () => ({ lat: 46.6, lng: 14.27 }),
    }),
    polyline: () => ({ ...layer, setLatLngs: () => {} }),
    circleMarker: () => layer,
    marker: () => ({ ...layer, setLatLng: () => {} }),
    divIcon: (options: { html: string }) => options,
  } as unknown as LeafletApi;
});

vi.mock('leaflet', () => ({ default: fakeL }));

const DATA: SceneData = {
  style: 'satellite',
  trailColor: null,
  tileUrl: 'app://bundle/tiles/satellite/{z}/{x}/{y}.png',
  view: 'follow',
  width: 768,
  height: 768,
  zoom: 15,
  center: { lat: 46.61, lon: 14.26 },
  attribution: 'Test Attribution',
  introN: 0,
  outroN: 0,
  lat: [46.61, 46.611],
  lon: [14.26, 14.261],
  alt: [10, 11],
  speed: [2.5, 3.1],
  headingDeg: [0, 90],
  hud: { heading: true, alt: true, speed: true },
  trailLat: [46.61],
  trailLon: [14.26],
  trailFrame: [0],
};

let observers: FakeObserver[] = [];

beforeEach(() => {
  observers = installResizeObserverStub();
  installRafStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MapIsland', () => {
  it('creates the shared scene and reports it', async () => {
    const onScene = vi.fn();
    render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    expect(observers[0]?.observed).toBe(true);
  });

  it('re-lays out after creation once the layout settles', async () => {
    const onScene = vi.fn();
    render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    const scene = onScene.mock.calls[0][0] as Scene;
    const relayout = vi.spyOn(scene, 'relayout').mockImplementation(() => {});
    act(() => flushRaf());
    expect(relayout).toHaveBeenCalledTimes(1);
  });

  it('re-lays out the scene when the host resizes', async () => {
    const onScene = vi.fn();
    render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    const scene = onScene.mock.calls[0][0] as Scene;
    const relayout = vi.spyOn(scene, 'relayout').mockImplementation(() => {});

    act(() => observers[0].cb([] as never, {} as never));
    expect(relayout).toHaveBeenCalledTimes(1);
  });

  it('stops observing on unmount', async () => {
    const onScene = vi.fn();
    const { unmount } = render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    unmount();
    expect(observers[0]?.disconnected).toBe(true);
  });

  it('disposes the scene on unmount so its styles do not leak', async () => {
    const onScene = vi.fn();
    const { unmount } = render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    const scene = onScene.mock.calls[0][0] as Scene;
    const dispose = vi.spyOn(scene, 'dispose');
    const stylesBefore = document.head.querySelectorAll('style').length;
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(document.head.querySelectorAll('style').length).toBe(stylesBefore - 1);
  });

  it('isolates the map stacking so leaflet cannot paint over the pip', () => {
    const { container } = render(<MapIsland data={DATA} onScene={vi.fn()} />);
    const host = container.querySelector('#scene-host') as HTMLElement;
    expect(host.style.isolation).toBe('isolate');
  });

  it('restyles the scene in place when the data changes', async () => {
    const onScene = vi.fn();
    const { rerender } = render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    const scene = onScene.mock.calls[0][0] as Scene;
    const update = vi
      .spyOn(scene, 'update')
      .mockImplementation(() => Promise.resolve());

    const changed = { ...DATA, style: 'topo' as const };
    rerender(<MapIsland data={changed} onScene={onScene} />);

    expect(update).toHaveBeenCalledWith(changed);
    expect(onScene).toHaveBeenCalledTimes(1);
  });
});
