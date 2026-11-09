// The jsdom scaffolding and shared fakes the UI suites install: the browser
// globals jsdom lacks (animation frames, resize observation), the scene
// stand-in, the shared session fixture and the module shapes the vi.mock
// factories return. Kept in one place so suites stop rebuilding each stub.

import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import type { UiSession } from '../../src/appsession.js';
import type { Scene } from '../../src/renderer/scene.js';

type FrameCallback = (now: number) => void;

const rafQueue: FrameCallback[] = [];
let rafNow = 0;

/** Runs the queued animation-frame callbacks once, each with a growing timestamp. */
export function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) {
    rafNow += 100;
    cb(rafNow);
  }
}

/** A deterministic requestAnimationFrame: callbacks run only through flushRaf(). */
export function installRafStub(): void {
  rafQueue.length = 0;
  rafNow = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameCallback): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {});
}

export interface FakeObserver {
  cb: ResizeObserverCallback;
  observed: boolean;
  disconnected: boolean;
}

/** Records every observer the code under test creates, for tests to fire and inspect. */
export function installResizeObserverStub(): FakeObserver[] {
  const observers: FakeObserver[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        observers.push({ cb, observed: false, disconnected: false });
      }
      observe(): void {
        observers[observers.length - 1].observed = true;
      }
      disconnect(): void {
        observers[observers.length - 1].disconnected = true;
      }
    },
  );
  return observers;
}

/** A fresh Scene stand-in whose every operation is a spy. */
export function createFakeScene(): Scene {
  return {
    setFrame: vi.fn(() => Promise.resolve()),
    relayout: vi.fn(),
    update: vi.fn(() => Promise.resolve()),
    ready: Promise.resolve(),
    dispose: vi.fn(),
  };
}

export const SESSION: UiSession = {
  scene: {
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
    lat: [46.61, 46.611, 46.612],
    lon: [14.26, 14.261, 14.262],
    alt: [10, 11, null],
    speed: [null, 2.5, 3.1],
    headingDeg: [0, 90, 180],
    hud: { heading: true, alt: true, speed: true },
    trailLat: [46.61, 46.612],
    trailLon: [14.26, 14.262],
    trailFrame: [0, 2],
  },
  video: { src: '/video', fps: 30, frames: 90, width: 1512, height: 2688 },
  tileBase: '/tiles',
  bbox: { minLat: 46.6, maxLat: 46.612, minLon: 14.26, maxLon: 14.262 },
  durationSec: 3,
};

interface MapIslandProps {
  onScene: (scene: Scene) => void;
}

type MapIslandModule = { MapIsland: (props: MapIslandProps) => ReactElement };

// The real island delivers its scene asynchronously (after the Leaflet
// chunk); this mock keeps that timing so late-arrival behavior stays covered.
export function delayedMapIslandMock(scene: Scene): MapIslandModule {
  return {
    MapIsland: ({ onScene }) => {
      useEffect(() => {
        const t = setTimeout(() => onScene(scene), 0);
        return () => clearTimeout(t);
      }, [onScene]);
      return <div data-testid="map-island" />;
    },
  };
}

// For suites that pin behavior after the scene arrives, not the arrival itself.
export function immediateMapIslandMock(scene: Scene): MapIslandModule {
  return {
    MapIsland: ({ onScene }) => {
      onScene(scene);
      return <div data-testid="map-island" />;
    },
  };
}

// The export preview boots a scene of its own; suites that only compose the
// dialog need just the placeholder it renders.
export function stubExportPreviewMock(): { ExportPreview: () => ReactElement } {
  return { ExportPreview: () => <div data-testid="export-preview" /> };
}
