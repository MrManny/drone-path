// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LatLngExpression } from 'leaflet';

import { bootScene } from '../../src/renderer/boot.js';
import type { LeafletApi, SceneData } from '../../src/renderer/scene.js';

function fakeL(): { L: LeafletApi; mapInvalidations: () => number } {
  let invalidations = 0;
  const layer = { addTo: () => {}, remove: () => {} };
  const L = {
    map: () => ({
      setView: () => {},
      getCenter: () => ({ lat: 46.6, lng: 14.26 }),
      project: (latlng: LatLngExpression) => ({
        x: (Array.isArray(latlng) ? latlng[0] : latlng.lat) * 1000,
        y: (Array.isArray(latlng) ? latlng[1] : latlng.lng) * 1000,
      }),
      invalidateSize: () => {
        invalidations += 1;
      },
      remove: () => {},
    }),
    tileLayer: () => ({ ...layer, on: () => {}, once: () => {}, setUrl: () => {} }),
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
  return { L, mapInvalidations: () => invalidations };
}

function sceneData(): SceneData {
  return {
    style: 'satellite',
    trailColor: null,
    tileUrl: '/tiles/satellite/{z}/{x}/{y}.png',
    view: 'overview',
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
    trailLat: [46.61, 46.611],
    trailLon: [14.26, 14.261],
    trailFrame: [0, 1],
  };
}

const rafCallbacks = new Map<number, () => void>();
let nextRafId = 0;

beforeEach(() => {
  rafCallbacks.clear();
  nextRafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
    nextRafId += 1;
    rafCallbacks.set(nextRafId, cb);
    return nextRafId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    rafCallbacks.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('bootScene', () => {
  it('runs a post-layout relayout on the next animation frame', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { L, mapInvalidations } = fakeL();
    const scene = bootScene(host, sceneData(), L);
    const relayout = vi.spyOn(scene, 'relayout');

    expect(mapInvalidations()).toBe(1);
    expect(rafCallbacks.size).toBe(1);

    for (const cb of [...rafCallbacks.values()]) cb();
    expect(relayout).toHaveBeenCalledTimes(1);
    expect(mapInvalidations()).toBe(2);

    scene.dispose();
  });

  it('cancels the pending post-layout relayout when disposed before the frame fires (#314)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { L, mapInvalidations } = fakeL();
    const scene = bootScene(host, sceneData(), L);
    const relayout = vi.spyOn(scene, 'relayout');

    const pending = [...rafCallbacks.values()];
    expect(pending).toHaveLength(1);

    scene.dispose();

    expect(rafCallbacks.size).toBe(0);
    // Even if a host flushes a previously captured frame callback, relayout stays inert.
    for (const cb of pending) cb();
    expect(relayout).not.toHaveBeenCalled();
    expect(mapInvalidations()).toBe(1);
  });
});
