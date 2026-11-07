// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Scene } from '../../src/renderer/scene.js';
import type { SceneData } from '../../src/renderer/scene.js';
import { MapCard } from '../../ui/components/MapCard.js';

const fakeScene = vi.hoisted((): Scene => ({
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  update: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
  dispose: vi.fn(),
}));

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { immediateMapIslandMock } = await import('./harness.js');
  return immediateMapIslandMock(fakeScene);
});

const DATA = {} as SceneData;

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
