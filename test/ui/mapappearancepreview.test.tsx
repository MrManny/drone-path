// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scene, SceneData } from 'drone-path-engine/renderer/scene';
import { MapAppearancePreview } from '../../ui/components/MapAppearancePreview.js';
import type { FakeObserver } from './harness.js';
import { installResizeObserverStub } from './harness.js';

const boot = vi.hoisted(() => ({
  calls: [] as { host: HTMLElement; data: SceneData; frame?: number }[],
  scenes: [] as Scene[],
}));

vi.mock('drone-path-engine/renderer/boot', async () => {
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
  view: 'overview',
  width: 1280,
  height: 720,
  zoom: 13,
  center: { lat: 46.61, lon: 14.26 },
  attribution: 'Test Attribution',
  introN: 0,
  outroN: 0,
  lat: [46.61, 46.611, 46.612],
  lon: [14.26, 14.261, 14.262],
  alt: [10, 11, 12],
  speed: [2.5, 3.1, 3.4],
  headingDeg: [0, 90, 180],
  hud: { heading: true, alt: false, speed: false },
  trailLat: [46.61, 46.612],
  trailLon: [14.26, 14.262],
  trailFrame: [0, 2],
};

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

function renderPreview(over: Partial<{ isExample: boolean; onToggleChip: (c: 'heading' | 'alt' | 'speed') => void }> = {}) {
  return render(
    <MapAppearancePreview
      data={DATA}
      frame={1}
      isExample={over.isExample ?? true}
      hud={{ heading: true, alt: true, speed: false }}
      readouts={{ headingDeg: 90, alt: 11, speed: 3.1 }}
      altUnavailable={false}
      onToggleChip={over.onToggleChip ?? (() => {})}
    />,
  );
}

describe('MapAppearancePreview', () => {
  it('names the example flight state so it cannot pass for user data', () => {
    renderPreview({ isExample: true });
    expect(
      screen.getByText('Example flight — open a recording to preview yours'),
    ).toBeTruthy();
  });

  it('names the recording state instead', () => {
    renderPreview({ isExample: false });
    expect(screen.getByText('Recording — the preview shows your flight')).toBeTruthy();
    expect(screen.queryByText(/Example flight/)).toBeNull();
  });

  it('draws the export frame at 16:9 through the map renderer', async () => {
    const { container } = renderPreview();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const frame = container.querySelector('.map-appearance-frame') as HTMLElement;
    expect(frame.style.aspectRatio).toBe('1280 / 720');
    expect(screen.getByText('export frame · 16:9')).toBeTruthy();
    expect(boot.calls[0].data).toBe(DATA);
  });

  it('stands on the preview frame and re-seeks when it changes', async () => {
    const { rerender } = renderPreview();
    await waitFor(() => expect(boot.scenes[0].setFrame).toHaveBeenCalledWith(1));
    rerender(
      <MapAppearancePreview
        data={DATA}
        frame={0}
        isExample
        hud={{ heading: true, alt: true, speed: false }}
        readouts={{ headingDeg: 90, alt: 11, speed: 3.1 }}
        altUnavailable={false}
        onToggleChip={() => {}}
      />,
    );
    await waitFor(() => expect(boot.scenes[0].setFrame).toHaveBeenCalledWith(0));
  });

  it('carries the chip toggles over the frame', () => {
    const onToggleChip = vi.fn();
    renderPreview({ onToggleChip });
    fireEvent.click(screen.getByRole('button', { name: /Altitude/ }));
    expect(onToggleChip).toHaveBeenCalledWith('alt');
  });

  it('keeps the frame box self-contained and observed', async () => {
    renderPreview();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    expect(observers[0].observed).toBe(true);
    expect(boot.calls[0].host.id).toBe('');
  });
});

describe('MapAppearancePreview style contract (#283)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cssText = fs.readFileSync(path.join(root, 'ui', 'app', 'globals.css'), 'utf8');

  it('puts the pill toggles where the export puts its pills', () => {
    const chips = /\.preview-chips \{([^}]*)\}/.exec(cssText)?.[1] ?? '';
    expect(chips).toContain('top: 16px');
    expect(chips).toContain('left: 16px');
    // The bottom-left placement — and its scale-bar collision offset — is
    // gone with it.
    expect(chips).not.toContain('bottom');
  });

  it('stacks the pill toggles in the export column', () => {
    const stack = /\.preview-chips \.hud-chips \{([^}]*)\}/.exec(cssText)?.[1] ?? '';
    expect(stack).toContain('flex-direction: column');
    expect(stack).toContain('align-items: flex-start');
  });
});
