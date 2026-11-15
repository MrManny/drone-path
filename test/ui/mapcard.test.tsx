// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
      expect(screen.getByText('No flight path yet.')).toBeTruthy();
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
    expect(screen.queryByText('No flight path yet.')).toBeNull();
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

  it('keeps one strip and its readout host alive across layout swaps for the scene', () => {
    const { container, rerender } = render(
      <MapCard data={DATA} onScene={() => {}} layout="split" />,
    );
    const strip = container.querySelector('.map-card-strip');
    const readouts = container.querySelector('.map-strip-readouts');
    rerender(<MapCard data={DATA} onScene={() => {}} layout="overlay" />);
    expect(container.querySelector('.map-card-strip')).toBe(strip);
    expect(container.querySelector('.map-strip-readouts')).toBe(readouts);
  });
});

describe('MapCard zoom column (#270, #272)', () => {
  const ZOOM_DATA = { zoom: 14 } as SceneData;
  const CONTROLS = { zoom: 14, style: 'satellite' as const, onStep: () => {} };

  it('mounts the bare stepper inside the strip below the map in split view', () => {
    const { container } = render(
      <MapCard data={ZOOM_DATA} onScene={() => {}} layout="split" zoomControls={CONTROLS} />,
    );
    const card = container.querySelector('.map-card') as HTMLElement;
    const map = card.querySelector('.map-card-map') as HTMLElement;
    const strip = card.querySelector('.map-card-strip') as HTMLElement;
    expect(strip).toBeTruthy();
    expect(map.nextElementSibling).toBe(strip);
    expect(container.querySelector('.map-card-zoom')).toBeNull();
    const zoomColumn = strip.querySelector('.map-strip-zoom') as HTMLElement;
    expect(zoomColumn.querySelector('.map-zoom-stepper')).toBeTruthy();
    expect(zoomColumn.querySelector('.label')?.textContent).toBe('Zoom');
    expect(screen.getByRole('group', { name: 'Map zoom' })).toBeTruthy();
  });

  it('keeps the zoom column out of the compact PiP card', () => {
    const { container } = render(
      <MapCard data={ZOOM_DATA} onScene={() => {}} layout="overlay" zoomControls={CONTROLS} />,
    );
    expect(container.querySelector('.map-strip-zoom')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Map zoom' })).toBeNull();
  });

  it('steps through the supplied zoom controls', () => {
    const onStep = vi.fn();
    render(
      <MapCard
        data={ZOOM_DATA}
        onScene={() => {}}
        layout="split"
        zoomControls={{ ...CONTROLS, onStep }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onStep).toHaveBeenNthCalledWith(1, 1);
    expect(onStep).toHaveBeenNthCalledWith(2, -1);
  });

  it('renders the readout host but no zoom column without zoom controls', () => {
    const { container } = render(<MapCard data={DATA} onScene={() => {}} layout="split" />);
    expect(container.querySelector('.map-strip-zoom')).toBeNull();
    expect(container.querySelector('.map-strip-readouts')).toBeTruthy();
  });
});

describe('MapCard style contract (#236)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cssText = fs.readFileSync(path.join(root, 'ui', 'app', 'globals.css'), 'utf8');

  it('keeps the readouts in one bottom strip outside the map image', () => {
    expect(cssText).toMatch(/\.map-card \{[^}]*flex-direction: column/);
    expect(cssText).toMatch(/\.map-card-map \{[^}]*flex: 1 1 auto/);
    expect(cssText).toMatch(/\.map-card-strip \{[^}]*flex: none/);
    // The strip never hides (#272): disabled chips keep their column and read "--".
    expect(cssText).not.toContain('.map-card-strip:empty');
  });

  it('stacks the strip labels above dimmable values', () => {
    expect(cssText).toMatch(/\.map-readout \.label,[^}]*font-size: 11px/);
    expect(cssText).toMatch(/\.map-readout \.value \{[^}]*font-size: 16px/);
    expect(cssText).toMatch(/\.map-readout-off \.value \{[^}]*color: var\(--text-3\)/);
  });

  it('aligns labels and values on two shared grid rows (#272 feedback)', () => {
    // One two-row grid: labels share a line and values and the stepper share
    // one baseline; the scene cells join the rows through display: contents.
    expect(cssText).toMatch(/\.map-card-strip \{[^}]*display: grid/);
    expect(cssText).toMatch(/\.map-card-strip \{[^}]*align-items: baseline/);
    expect(cssText).toMatch(/\.map-strip-readouts,[^}]*display: contents/);
    expect(cssText).toMatch(/\.map-readout \.label,[^}]*grid-row: 1/);
    expect(cssText).toMatch(/\.map-readout \.value \{[^}]*grid-row: 2/);
    expect(cssText).toMatch(/#chip-speed \.label,[^}]*grid-column: 1/);
    expect(cssText).toMatch(/#chip-alt \.label,[^}]*grid-column: 2/);
    expect(cssText).toMatch(/\.map-strip-zoom \.map-zoom-stepper \{[^}]*grid-row: 2/);
  });

  it('keeps every value-line box on one 30px baseline (#272 feedback)', () => {
    // The value and the stepper buttons share identical 30px line boxes in
    // plain inline flow, so the glyphs sit on one text baseline by
    // construction — no flex baseline synthesis to drift.
    expect(cssText).toMatch(/\.map-readout \.value \{[^}]*line-height: 30px/);
    expect(cssText).toMatch(/\.map-zoom-stepper \{[^}]*line-height: 30px/);
    expect(cssText).toMatch(/\.map-zoom-stepper button \{[^}]*line-height: 30px/);
    expect(cssText).toMatch(/\.map-zoom-stepper button \{[^}]*display: inline-block/);
  });

  it('scales the strip micro-labels down in the compact card', () => {
    expect(cssText).toMatch(/\.map-card-overlay \.map-readout \.label,[^}]*font-size: 9px/);
    expect(cssText).toMatch(/\.map-card-overlay \.map-readout \.value \{[^}]*font-size: 12px/);
    expect(cssText).toMatch(/\.map-card-overlay \.map-readout \.unit \{[^}]*font-size: 9px/);
  });

  it('keeps the zoom stepper bare with no pill container or borders (#272)', () => {
    expect(cssText).not.toContain('.map-zoom-pill');
    expect(cssText).not.toContain('.map-card-zoom');
    const group = /\.map-zoom-stepper \{([^}]*)\}/.exec(cssText)?.[1] ?? '';
    expect(group).not.toContain('border');
    expect(group).not.toContain('background');
    const buttons = /\.map-zoom-stepper button \{([^}]*)\}/.exec(cssText)?.[1] ?? '';
    expect(buttons).toContain('border: 0');
    expect(buttons).toContain('background: transparent');
  });

  it('renders the compact attribution flush on the map bottom row', () => {
    const rule = /\.map-card\.map-card-overlay #attr \{([^}]*)\}/.exec(cssText)?.[1] ?? '';
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('text-overflow: ellipsis');
    // Flush against the map's bottom edge; the scale bar keeps the bottom-left
    // corner and the credit clears it by width, never by lifting off the edge.
    expect(rule).toContain('bottom: 0');
    expect(rule).not.toContain('bottom: 32px');
    expect(rule).toContain('max-width: calc(100% - 128px)');
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
