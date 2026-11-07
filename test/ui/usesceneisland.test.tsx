// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { SceneIslandOptions } from '../../ui/hooks/useSceneIsland.js';
import { useSceneIsland } from '../../ui/hooks/useSceneIsland.js';

const boot = vi.hoisted(() => ({ scenes: [] as Scene[], calls: 0 }));

vi.mock('../../src/renderer/boot.js', () => ({
  bootScene: (): Scene => {
    boot.calls += 1;
    const scene = {
      setFrame: vi.fn(() => Promise.resolve()),
      relayout: vi.fn(),
      update: vi.fn(() => Promise.resolve()),
      ready: Promise.resolve(),
      dispose: vi.fn(),
    } satisfies Scene;
    boot.scenes.push(scene);
    return scene;
  },
}));

vi.mock('leaflet', () => ({ default: {} }));

const DATA = {
  style: 'satellite',
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
  trailLat: [46.61],
  trailLon: [14.26],
  trailFrame: [0],
} satisfies SceneData;

function Island({ data, frame, onScene }: SceneIslandOptions) {
  const hostRef = useSceneIsland({ data, frame, onScene });
  return <div ref={hostRef} />;
}

interface FakeObserver {
  cb: ResizeObserverCallback;
  disconnected: boolean;
}

const observers: FakeObserver[] = [];

function scene(): Scene {
  return boot.scenes[boot.scenes.length - 1];
}

beforeEach(() => {
  observers.length = 0;
  boot.calls = 0;
  boot.scenes.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        observers.push({ cb, disconnected: false });
      }
      observe(): void {}
      disconnect(): void {
        observers[observers.length - 1].disconnected = true;
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useSceneIsland', () => {
  it('boots the shared scene and reports it', async () => {
    const onScene = vi.fn();
    render(<Island data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    expect(boot.calls).toBe(1);
  });

  it('seeks the given frame and re-seeks on change', async () => {
    const { rerender } = render(<Island data={DATA} frame={10} />);
    await waitFor(() => expect(scene().setFrame).toHaveBeenCalledWith(10));
    rerender(<Island data={DATA} frame={20} />);
    await waitFor(() => expect(scene().setFrame).toHaveBeenCalledWith(20));
  });

  it('never seeks a host without a frame (the player drives those)', async () => {
    render(<Island data={DATA} />);
    await waitFor(() => expect(boot.calls).toBe(1));
    expect(scene().setFrame).not.toHaveBeenCalled();
  });

  it('restyles the scene in place when the data changes', async () => {
    const { rerender } = render(<Island data={DATA} />);
    await waitFor(() => expect(boot.calls).toBe(1));
    rerender(<Island data={{ ...DATA, style: 'topo' }} />);
    await waitFor(() => expect(scene().update).toHaveBeenCalled());
    expect(boot.calls).toBe(1);
  });

  it('re-lays out on host resize and disposes on unmount', async () => {
    const { unmount } = render(<Island data={DATA} />);
    await waitFor(() => expect(boot.calls).toBe(1));

    act(() => observers[0].cb([] as never, {} as never));
    expect(scene().relayout).toHaveBeenCalledTimes(1);

    unmount();
    expect(scene().dispose).toHaveBeenCalledTimes(1);
    expect(observers[0].disconnected).toBe(true);
  });
});
