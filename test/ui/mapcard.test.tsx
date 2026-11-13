// @vitest-environment jsdom
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
