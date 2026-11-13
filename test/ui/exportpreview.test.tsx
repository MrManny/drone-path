// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { Scene, SceneData } from '../../src/renderer/scene.js';
import { ExportPreview } from '../../ui/components/ExportPreview.js';
import type { FakeObserver } from './harness.js';
import { installResizeObserverStub } from './harness.js';

const boot = vi.hoisted(() => ({
  scenes: [] as Scene[],
  calls: [] as { host: HTMLElement; data: SceneData }[],
}));

vi.mock('../../src/renderer/boot.js', async () => {
  const { createFakeScene } = await import('./harness.js');
  return {
    bootScene: (host: HTMLElement, data: SceneData): Scene => {
      boot.calls.push({ host, data });
      const scene = createFakeScene();
      boot.scenes.push(scene);
      return scene;
    },
  };
});

vi.mock('leaflet', () => ({ default: {} }));

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
  lat: [46.61, 46.611, 46.612],
  lon: [14.26, 14.261, 14.262],
  alt: [10, 11, 12],
  speed: [2.5, 3.1, 3.4],
  headingDeg: [0, 90, 180],
  hud: { heading: true, alt: true, speed: true },
  trailLat: [46.61, 46.611, 46.612],
  trailLon: [14.26, 14.261, 14.262],
  trailFrame: [0, 1, 2],
};

const SESSION: UiSession = {
  scene: DATA,
  video: { src: 'app://bundle/media/video', fps: 30, frames: 300, width: 1280, height: 720 },
  tileBase: 'app://bundle/tiles',
  bbox: { minLat: 46.605, maxLat: 46.615, minLon: 14.255, maxLon: 14.265 },
  durationSec: 10,
};

const CONFIG: RenderConfig = { ...DEFAULT_CONFIG, width: 768, height: 768 };

let observers: FakeObserver[] = [];

beforeEach(() => {
  observers = installResizeObserverStub();
  boot.calls.length = 0;
  boot.scenes.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPreview(overrides: Partial<{ config: RenderConfig; frame: number; note: boolean }> = {}) {
  return render(
    <ExportPreview
      session={SESSION}
      config={overrides.config ?? CONFIG}
      size={{ width: 1280, height: 720 }}
      frame={overrides.frame ?? 100}
      note={overrides.note ?? false}
    />,
  );
}

function scene(): Scene {
  return boot.scenes[0];
}

describe('ExportPreview scene', () => {
  it('boots the shared scene planned at the output size', async () => {
    const { container } = renderPreview();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const { host, data } = boot.calls[0];
    expect(host).toBe(container.querySelector('.scene-host'));
    expect(data.width).toBe(1280);
    expect(data.height).toBe(720);
    expect(data.tileUrl).toBe('app://bundle/tiles/satellite/{z}/{x}/{y}.png');
  });

  it('stands on the representative frame and re-seeks when it changes', async () => {
    const { rerender } = renderPreview({ frame: 100 });
    await waitFor(() => expect(scene().setFrame).toHaveBeenCalledWith(100));
    rerender(
      <ExportPreview session={SESSION} config={CONFIG} size={{ width: 1280, height: 720 }} frame={200} />,
    );
    await waitFor(() => expect(scene().setFrame).toHaveBeenCalledWith(200));
  });

  it('restyles the scene in place when the data changes', async () => {
    const { rerender } = renderPreview();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    rerender(
      <ExportPreview
        session={SESSION}
        config={{ ...CONFIG, style: 'topo' }}
        size={{ width: 1280, height: 720 }}
        frame={100}
      />,
    );
    await waitFor(() =>
      expect(scene().update).toHaveBeenCalledWith(
        expect.objectContaining({ tileUrl: 'app://bundle/tiles/topo/{z}/{x}/{y}.png' }),
      ),
    );
    expect(boot.calls).toHaveLength(1);
  });

  it('re-lays out the scene when the frame box resizes', async () => {
    renderPreview();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    expect(observers[0].observed).toBe(true);

    act(() => observers[0].cb([] as never, {} as never));
    expect(scene().relayout).toHaveBeenCalledTimes(1);
  });

  it('disposes the scene and stops observing on unmount', async () => {
    const { unmount } = renderPreview();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    unmount();
    expect(scene().dispose).toHaveBeenCalledTimes(1);
    expect(observers[0].disconnected).toBe(true);
    act(() => observers[0].cb([] as never, {} as never));
    expect(scene().relayout).not.toHaveBeenCalled();
  });

  it('keeps the scene stacking inside its own box without claiming the player host id', async () => {
    const { container } = renderPreview();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const host = container.querySelector('.scene-host') as HTMLElement;
    expect(host.style.isolation).toBe('isolate');
    expect(host.id).toBe('');
  });
});

describe('ExportPreview output framing', () => {
  it('shows the caption and the committed size', () => {
    const { getByText } = renderPreview();
    expect(getByText('Output preview')).toBeTruthy();
    expect(getByText('1280×720')).toBeTruthy();
  });

  it('states the map-only rule only when the form asks for it', () => {
    const { getByText, queryByText, rerender } = renderPreview({ note: true });
    expect(getByText('Export renders the map, not the source video.')).toBeTruthy();
    rerender(
      <ExportPreview
        session={SESSION}
        config={CONFIG}
        size={{ width: 1280, height: 720 }}
        frame={100}
        note={false}
      />,
    );
    expect(queryByText('Export renders the map, not the source video.')).toBeNull();
  });

  it('keeps the frame box at the output aspect ratio', () => {
    const { container } = renderPreview();
    const frame = container.querySelector('.export-preview-frame') as HTMLElement;
    expect(frame.style.aspectRatio).toBe('1280 / 720');
    expect(frame.style.getPropertyValue('--export-preview-cap')).toBe('calc(300px * 1280 / 720)');
  });

  it('renders no footage anywhere in the preview', () => {
    const { container } = renderPreview();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
