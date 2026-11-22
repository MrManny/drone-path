// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiSession } from '../../shared/contracts.js';
import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import type { Scene, SceneData } from 'drone-path-engine/renderer/scene';
import { MapAppearanceModal } from '../../ui/components/MapAppearanceModal.js';
import type { FakeObserver } from './harness.js';
import { SESSION, createFakeScene, installResizeObserverStub } from './harness.js';

const boot = vi.hoisted(() => ({
  calls: [] as { host: HTMLElement; data: SceneData }[],
  scenes: [] as Scene[],
}));

vi.mock('drone-path-engine/renderer/boot', () => ({
  bootScene: (host: HTMLElement, data: SceneData): Scene => {
    boot.calls.push({ host, data });
    const scene = createFakeScene();
    boot.scenes.push(scene);
    return scene;
  },
}));

vi.mock('leaflet', () => ({ default: {} }));

const NO_ALT_SESSION: UiSession = {
  ...SESSION,
  scene: { ...SESSION.scene, alt: [null, null, null] },
};

let observers: FakeObserver[] = [];

beforeEach(() => {
  observers = installResizeObserverStub();
  boot.calls.length = 0;
  boot.scenes.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface HarnessProps {
  session: UiSession | null;
  initial?: RenderConfig;
  onClose?: () => void;
  onConfig?: (config: RenderConfig) => void;
}

function Harness({ session, initial, onClose = () => {}, onConfig = () => {} }: HarnessProps) {
  const [config, setConfig] = useState(initial ?? DEFAULT_CONFIG);
  return (
    <MapAppearanceModal
      session={session}
      config={config}
      onChange={(next) => {
        onConfig(next);
        setConfig(next);
      }}
      onClose={onClose}
    />
  );
}

function renderModal(over: Partial<HarnessProps> = {}) {
  return render(
    <Harness
      session={over.session === undefined ? SESSION : over.session}
      initial={over.initial}
      onClose={over.onClose}
      onConfig={over.onConfig}
    />,
  );
}

function chipsIn(selector: string): HTMLButtonElement[] {
  const container = document.querySelector(selector) as HTMLElement;
  return [...container.querySelectorAll('button')];
}

describe('MapAppearanceModal structure', () => {
  it('opens as a modal dialog with the grouped settings and the preview', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Map appearance' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Every change shows in the preview at once.')).toBeTruthy();
    for (const legend of ['Map look', 'Camera', 'On-frame readouts', 'Intro & outro']) {
      expect(screen.getByText(legend)).toBeTruthy();
    }
    expect(screen.getByRole('group', { name: 'Flight structure' })).toBeTruthy();
    expect(document.querySelectorAll('.map-appearance-frame')).toHaveLength(1);
  });

  it('closes from the footer button', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const footer = document.querySelector('.dialog-actions') as HTMLElement;
    const close = within(footer).getByRole('button', { name: 'Done' });
    expect(close.className).toBe('dialog-primary');
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(within(footer).getByRole('button', { name: 'Restore defaults' })).toBeTruthy();
  });
});

interface ControlCase {
  name: string;
  initial: RenderConfig;
  act: () => void;
  want: Record<string, unknown>;
}

const CONTROL_CASES: ControlCase[] = [
  {
    name: 'map style tile',
    initial: DEFAULT_CONFIG,
    act: () => fireEvent.click(screen.getByRole('button', { name: 'Topographic' })),
    want: { style: 'topo' },
  },
    {
      name: 'trail color swatch',
      initial: DEFAULT_CONFIG,
      act: () => fireEvent.click(screen.getByRole('button', { name: 'White' })),
      want: { trailColor: '#ffffff' },
    },
    {
      name: 'camera view',
      initial: DEFAULT_CONFIG,
      act: () => fireEvent.click(screen.getByRole('button', { name: 'Follow' })),
      want: { view: 'follow' },
    },
    {
      name: 'auto-fit toggle',
      initial: DEFAULT_CONFIG,
      act: () => fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-fit zoom' })),
      want: { zoom: 'resolved' },
    },
    {
      name: 'zoom slider',
      initial: { ...DEFAULT_CONFIG, zoom: 13 },
      act: () => fireEvent.change(screen.getByLabelText('Zoom level'), { target: { value: '17' } }),
      want: { zoom: 17 },
    },
    {
      name: 'frame padding slider',
      initial: DEFAULT_CONFIG,
      act: () =>
        fireEvent.change(screen.getByLabelText('Frame padding'), { target: { value: '3' } }),
      want: { zoomOut: 3 },
    },
    {
      name: 'intro stepper',
      initial: DEFAULT_CONFIG,
      act: () => fireEvent.change(screen.getByLabelText('Intro length'), { target: { value: '3' } }),
      want: { introSec: 3 },
    },
    {
      name: 'outro stepper',
      initial: DEFAULT_CONFIG,
      act: () => fireEvent.change(screen.getByLabelText('Outro length'), { target: { value: '0' } }),
      want: { outroSec: 0 },
    },
    {
      name: 'chip toggle',
      initial: DEFAULT_CONFIG,
      act: () => {
        const chip = chipsIn('.preview-chips').find((b) => b.textContent?.includes('SPD'));
        fireEvent.click(chip as HTMLButtonElement);
      },
      want: { hud: { heading: true, alt: false, speed: true } },
    },
  ];

describe('MapAppearanceModal controls', () => {
  it.for(CONTROL_CASES)('applies the $name to the config', ({ initial, act, want }) => {
    const onConfig = vi.fn();
    renderModal({ initial, onConfig });
    act();
    if (want.zoom === 'resolved') {
      // Turning auto-fit off pins the level the preview resolved to.
      expect(onConfig).toHaveBeenCalledWith(expect.objectContaining({ zoom: expect.any(Number) }));
      expect(onConfig.mock.calls[0][0].zoom).toBeGreaterThan(0);
    } else {
      expect(onConfig).toHaveBeenCalledWith(expect.objectContaining(want));
    }
  });

  it('restores exactly the appearance defaults and keeps the rest', () => {
    const onConfig = vi.fn();
    renderModal({
      initial: {
        ...DEFAULT_CONFIG,
        style: 'topo',
        view: 'overview',
        zoom: 9,
        zoomOut: 4,
        introSec: 5,
        outroSec: 0.5,
        trailColor: '#41f0ff',
        outDir: '/exports',
        codec: 'h265',
        quality: 'low',
      },
      onConfig,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(onConfig).toHaveBeenCalledWith({
      ...DEFAULT_CONFIG,
      style: 'satellite',
      view: 'follow',
      zoom: 0,
      zoomOut: 1,
      introSec: 2,
      outroSec: 2,
      trailColor: null,
      outDir: '/exports',
      codec: 'h265',
      quality: 'low',
      hud: { ...DEFAULT_CONFIG.hud },
    });
  });
});

describe('MapAppearanceModal chips', () => {
  it('toggles a chip from the preview and keeps the card in sync', async () => {
    renderModal();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const [previewChip] = chipsIn('.preview-chips').filter((b) => b.textContent?.includes('ALT'));
    expect(previewChip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(previewChip);
    for (const chip of chipsIn('.preview-chips').concat(chipsIn('.map-appearance-cards'))) {
      if (chip.getAttribute('aria-label')?.startsWith('Altitude')) {
        expect(chip.getAttribute('aria-pressed')).toBe('true');
      }
    }
  });

  it('toggles a chip from the card and keeps the preview in sync', async () => {
    renderModal();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const cardChip = chipsIn('.map-appearance-cards').find((b) =>
      b.textContent?.includes('Speed'),
    ) as HTMLButtonElement;
    fireEvent.click(cardChip);
    const previewChip = chipsIn('.preview-chips').find((b) =>
      b.textContent?.includes('SPD'),
    ) as HTMLButtonElement;
    expect(cardChip.getAttribute('aria-pressed')).toBe('true');
    expect(previewChip.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the ALT chip off with a text notice when the telemetry has none', () => {
    renderModal({ session: NO_ALT_SESSION });
    for (const chip of chipsIn('.preview-chips').concat(chipsIn('.map-appearance-cards'))) {
      if (chip.getAttribute('aria-label')?.startsWith('Altitude')) {
        expect(chip.disabled).toBe(true);
        expect(chip.textContent).toContain('--');
      }
    }
    expect(
      screen.getByText(
        'This recording has no altitude telemetry, so the Altitude chip stays off and the map strip shows no Altitude value.',
      ),
    ).toBeTruthy();
  });

  it('enables the ALT chip when the telemetry carries altitude', () => {
    renderModal({ session: SESSION });
    const alt = chipsIn('.preview-chips').find((b) => b.textContent?.includes('ALT'));
    expect(alt?.disabled).toBe(false);
    expect(screen.queryByText(/no altitude telemetry/)).toBeNull();
  });
});

describe('MapAppearanceModal preview', () => {
  it('draws the example flight without a recording and names it', async () => {
    renderModal({ session: null });
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    expect(
      screen.getByText('Example flight — open a recording to preview yours'),
    ).toBeTruthy();
    const { data } = boot.calls[0];
    expect(data.width).toBe(1280);
    expect(data.height).toBe(720);
    expect(data.tileUrl).toContain('/tiles/satellite/{z}/{x}/{y}.png');
    // The chips over the frame stand in for the export HUD pills, so the
    // scene draws none of its own (#283).
    expect(data.hudPills).toBe(false);
  });

  it('keeps the real HUD flags on the preview scene for the marker arrow (#283)', async () => {
    renderModal({
      session: null,
      initial: { ...DEFAULT_CONFIG, hud: { heading: true, alt: true, speed: true } },
    });
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const { data } = boot.calls[0];
    // Not falsified: the marker arrow follows the heading setting exactly as
    // the export does; only the pill drawing is suppressed.
    expect(data.hud).toEqual({ heading: true, alt: true, speed: true });
    expect(data.hudPills).toBe(false);
  });

  it('reads plausible example values into the chips', async () => {
    renderModal({
      session: null,
      initial: { ...DEFAULT_CONFIG, hud: { heading: true, alt: true, speed: true } },
    });
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const alt = chipsIn('.preview-chips').find((b) => b.textContent?.includes('ALT'));
    expect(alt?.textContent).toMatch(/ALT\d+m/);
  });

  it('names the recording state and previews the recording', async () => {
    renderModal({ session: SESSION });
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    expect(screen.getByText('Recording — the preview shows your flight')).toBeTruthy();
    expect(boot.calls[0].data.lat).toEqual(SESSION.scene.lat);
  });

  it('restyles at once when a setting changes', async () => {
    renderModal();
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Topographic' }));
    await waitFor(() =>
      expect(boot.scenes[0].update).toHaveBeenCalledWith(
        expect.objectContaining({ tileUrl: expect.stringContaining('/tiles/topo/') }),
      ),
    );
    expect(boot.calls).toHaveLength(1);
    expect(observers.length).toBeGreaterThan(0);
  });

  it('shows the resolved level under auto-fit', async () => {
    renderModal({ session: null });
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const resolved = boot.calls[0].data.zoom;
    expect(screen.getByText(`auto-fit → ${resolved}`)).toBeTruthy();
  });

  it('moves the preview frame through the structure bar segments', async () => {
    renderModal({ session: null });
    await waitFor(() => expect(boot.calls).toHaveLength(1));
    const frames = boot.calls[0].data.lat.length;
    const bar = screen.getByRole('group', { name: 'Flight structure' });
    fireEvent.click(within(bar).getByRole('button', { name: /intro/ }));
    await waitFor(() => expect(boot.scenes[0].setFrame).toHaveBeenCalledWith(0));
    fireEvent.click(within(bar).getByRole('button', { name: /outro/ }));
    await waitFor(() =>
      expect(boot.scenes[0].setFrame).toHaveBeenCalledWith(frames - 1),
    );
  });
});
