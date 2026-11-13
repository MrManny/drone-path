// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scene } from '../../src/renderer/scene.js';
import type { SceneData } from '../../src/renderer/scene.js';
import { MapCard } from '../../ui/components/MapCard.js';
import { createDeferredScene } from './harness.js';

const fakeScene = vi.hoisted((): Scene => ({
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  update: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
  dispose: vi.fn(),
}));

const slots = vi.hoisted(() => ({ scene: fakeScene }));

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { slotMapIslandMock } = await import('./harness.js');
  return slotMapIslandMock(() => slots.scene);
});

const DATA = {} as SceneData;

beforeEach(() => {
  slots.scene = fakeScene;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(layout: 'split' | 'overlay') {
  return render(<MapCard data={DATA} onScene={() => {}} layout={layout} />);
}

describe('MapCard', () => {
  it.for(['split', 'overlay'] as const)(
    'renders a bare map with no card copy in the %s layout (#157)',
    (layout) => {
      renderCard(layout);
      expect(screen.queryByRole('heading')).toBeNull();
      expect(screen.queryByText('Flight map')).toBeNull();
      expect(screen.queryByText('Satellite · Overview')).toBeNull();
      expect(screen.queryByText('Current position')).toBeNull();
      expect(screen.queryByText('Map and video share the same playhead.')).toBeNull();
    },
  );

  it('renders the map tag for the overlay layout', () => {
    renderCard('overlay');
    expect(screen.getByText('Map')).toBeTruthy();
  });

  it.for(['split', 'overlay'] as const)('carries no synced wording in the %s layout', (layout) => {
    renderCard(layout);
    expect(screen.queryByText('Synced')).toBeNull();
    expect(screen.queryByText('Map · synced')).toBeNull();
  });

  it('switches layout classes without remounting the map island', () => {
    const { rerender, container } = renderCard('split');
    const card = container.querySelector('.map-card') as HTMLElement;
    expect(card.className).toContain('map-card-split');
    const island = screen.getByTestId('map-island');
    rerender(<MapCard data={DATA} onScene={() => {}} layout="overlay" />);
    expect(card.className).toContain('map-card-overlay');
    expect(screen.getByTestId('map-island')).toBe(island);
    expect(vi.mocked(fakeScene.setFrame)).not.toHaveBeenCalled();
  });
});

describe('MapCard empty variant', () => {
  it.for(['split', 'overlay'] as const)(
    'reads the quiet placeholder with no island in the %s layout',
    (layout) => {
      render(<MapCard data={null} layout={layout} />);
      expect(screen.getByText('No telemetry yet')).toBeTruthy();
      expect(screen.queryByTestId('map-island')).toBeNull();
      const card = document.querySelector('.map-card') as HTMLElement;
      expect(card.className).toBe(`map-card map-card-${layout}`);
    },
  );

  it('mounts the island as soon as a scene exists', () => {
    const { rerender } = render(<MapCard data={null} layout="split" />);
    expect(screen.queryByTestId('map-island')).toBeNull();
    rerender(<MapCard data={DATA} onScene={() => {}} layout="split" />);
    expect(screen.getByTestId('map-island')).toBeTruthy();
    expect(screen.queryByText('No telemetry yet')).toBeNull();
  });
});

describe('MapCard map-loading busy state', () => {
  it.for(['split', 'overlay'] as const)(
    'shows the text busy state until the map settles in the %s layout',
    async (layout) => {
      const { scene, resolveReady } = createDeferredScene();
      slots.scene = scene;
      render(<MapCard data={DATA} onScene={() => {}} layout={layout} />);
      const busy = screen.getByRole('status');
      expect(busy.textContent).toBe('Preparing map…');
      await act(async () => {
        resolveReady();
      });
      expect(screen.queryByText('Preparing map…')).toBeNull();
    },
  );

  it('stays busy across layout swaps until the map settles', async () => {
    const { scene, resolveReady } = createDeferredScene();
    slots.scene = scene;
    const { rerender } = render(<MapCard data={DATA} onScene={() => {}} layout="split" />);
    expect(screen.getByText('Preparing map…')).toBeTruthy();
    rerender(<MapCard data={DATA} onScene={() => {}} layout="overlay" />);
    expect(screen.getByText('Preparing map…')).toBeTruthy();
    await act(async () => {
      resolveReady();
    });
    expect(screen.queryByText('Preparing map…')).toBeNull();
  });

  it.for(['split', 'overlay'] as const)(
    'shows no busy state on the quiet placeholder in the %s layout',
    (layout) => {
      render(<MapCard data={null} layout={layout} />);
      expect(screen.queryByText('Preparing map…')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    },
  );
});

describe('MapCard chip strip (#236)', () => {
  it.for(['split', 'overlay'] as const)(
    'mounts the strip outside the map area in the %s layout',
    (layout) => {
      const { container } = render(<MapCard data={DATA} onScene={() => {}} layout={layout} />);
      const card = container.querySelector('.map-card') as HTMLElement;
      const map = card.querySelector('.map-card-map') as HTMLElement;
      const strip = card.querySelector('.map-card-strip') as HTMLElement;
      expect(map).toBeTruthy();
      expect(strip).toBeTruthy();
      expect(map.nextElementSibling).toBe(strip);
    },
  );

  it('keeps the island in the map area and the busy label on the card', () => {
    const { container } = render(<MapCard data={DATA} onScene={() => {}} layout="split" />);
    const card = container.querySelector('.map-card') as HTMLElement;
    expect(card.querySelector('.map-card-map [data-testid="map-island"]')).toBeTruthy();
    expect(card.querySelector('.map-card-busy')?.parentElement).toBe(card);
  });

  it('renders no strip on the quiet placeholder', () => {
    const { container } = render(<MapCard data={null} layout="split" />);
    expect(container.querySelector('.map-card-strip')).toBeNull();
    expect(container.querySelector('.map-card-map')).toBeNull();
  });

  it('keeps one strip element alive across layout swaps for the scene', () => {
    const { container, rerender } = render(
      <MapCard data={DATA} onScene={() => {}} layout="split" />,
    );
    const strip = container.querySelector('.map-card-strip');
    rerender(<MapCard data={DATA} onScene={() => {}} layout="overlay" />);
    expect(container.querySelector('.map-card-strip')).toBe(strip);
  });
});

describe('MapCard style contract (#236)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cssText = fs.readFileSync(path.join(root, 'ui', 'app', 'globals.css'), 'utf8');

  it('keeps the chips in a bottom strip outside the map image', () => {
    expect(cssText).toMatch(/\.map-card \{[^}]*flex-direction: column/);
    expect(cssText).toMatch(/\.map-card-map \{[^}]*flex: 1 1 auto/);
    expect(cssText).toMatch(/\.map-card-strip \{[^}]*flex: none/);
    expect(cssText).toMatch(/\.map-card-strip:empty \{[^}]*display: none/);
  });

  it('scales the chip micro-labels down in the compact card', () => {
    expect(cssText).toMatch(/\.map-card-strip \.chip \.label \{[^}]*font-size: 10px/);
    expect(cssText).toMatch(
      /\.map-card-overlay \.map-card-strip \.chip \.label \{[^}]*font-size: 9px/,
    );
    expect(cssText).toMatch(
      /\.map-card-overlay \.map-card-strip \.chip \{[^}]*font-size: 12px/,
    );
  });

  it('renders the compact attribution on one line clear of the scale bar', () => {
    const rule = /\.map-card\.map-card-overlay #attr \{([^}]*)\}/.exec(cssText)?.[1] ?? '';
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('text-overflow: ellipsis');
    expect(rule).toContain('bottom: 32px');
    expect(rule).toContain('pointer-events: auto');
    expect(cssText).toMatch(/\.map-card\.map-card-overlay #attr a \{[^}]*pointer-events: none/);
  });

  it('leaves the map-loading busy label rules untouched (#234)', () => {
    const rule = /\.map-card-busy \{([^}]*)\}/.exec(cssText)?.[1] ?? '';
    expect(rule).toContain('z-index: 1300');
    expect(rule).toContain('bottom: calc(50% + 56px)');
    expect(cssText).toMatch(/\.map-card-overlay \.map-card-busy \{[^}]*top: 34px/);
    expect(cssText).toMatch(/\.map-card-overlay \.map-card-busy \{[^}]*bottom: auto/);
  });
});
