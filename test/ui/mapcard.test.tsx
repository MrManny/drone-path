// @vitest-environment jsdom
import { createRef } from 'react';
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

function renderCard(layout: 'split' | 'overlay', settings = { style: 'satellite' as const, view: 'overview' as const }) {
  const positionRef = createRef<HTMLSpanElement>();
  const view = render(
    <MapCard
      data={DATA}
      onScene={() => {}}
      layout={layout}
      settings={settings}
      positionReadout="0:00 / 0:03"
      positionRef={positionRef}
    />,
  );
  return { ...view, positionRef };
}

describe('MapCard', () => {
  it('names the map and its look in the card header', () => {
    renderCard('split');
    expect(screen.getByRole('heading', { name: 'Flight map' })).toBeTruthy();
    expect(screen.getByText('Satellite · Overview')).toBeTruthy();
  });

  it('shows the shared playhead position and note', () => {
    const { positionRef } = renderCard('split');
    expect(screen.getByText('Current position')).toBeTruthy();
    expect(positionRef.current?.textContent).toBe('0:00 / 0:03');
    expect(screen.getByText('Map and video share the same playhead.')).toBeTruthy();
  });

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
    rerender(
      <MapCard
        data={DATA}
        onScene={() => {}}
        layout="overlay"
        settings={{ style: 'satellite', view: 'overview' }}
        positionReadout="0:00 / 0:03"
        positionRef={createRef<HTMLSpanElement>()}
      />,
    );
    expect(card.className).toContain('map-card-overlay');
    expect(screen.getByTestId('map-island')).toBe(island);
    expect(vi.mocked(fakeScene.setFrame)).not.toHaveBeenCalled();
  });
});
