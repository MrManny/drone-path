// @vitest-environment jsdom
import type { RefObject } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MapStrip } from '../../ui/components/MapStrip.js';
import type { ZoomControls } from '../../ui/lib/mapzoom.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CONTROLS: ZoomControls = { zoom: 0, style: 'satellite', onStep: () => {} };

function renderStrip(
  layout: 'split' | 'overlay',
  zoomControls?: ZoomControls,
  hudHostRef: RefObject<HTMLDivElement | null> = { current: null },
) {
  const view = render(
    <MapStrip
      hudHostRef={hudHostRef}
      layout={layout}
      zoomControls={zoomControls}
      visibleZoom={14}
    />,
  );
  return { ...view, hudHostRef };
}

describe('MapStrip (#272)', () => {
  it('renders the scene-owned readout host inside the strip', () => {
    const { container, hudHostRef } = renderStrip('split');
    const strip = container.querySelector('.map-card-strip') as HTMLElement;
    const readouts = strip.querySelector('.map-strip-readouts') as HTMLElement;
    expect(readouts).toBeTruthy();
    expect(hudHostRef.current).toBe(readouts);
  });

  it('mounts the labeled bare zoom stepper in split view', () => {
    renderStrip('split', CONTROLS);
    expect(screen.getByText('Zoom')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Map zoom' })).toBeTruthy();
  });

  it('keeps the zoom column out of the PiP layout', () => {
    const { container } = renderStrip('overlay', CONTROLS);
    expect(container.querySelector('.map-strip-zoom')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Map zoom' })).toBeNull();
  });

  it('renders the readout host but no zoom column without zoom controls', () => {
    const { container } = renderStrip('split');
    expect(container.querySelector('.map-strip-readouts')).toBeTruthy();
    expect(container.querySelector('.map-strip-zoom')).toBeNull();
  });

  it('routes step presses to the zoom controls', () => {
    const onStep = vi.fn();
    renderStrip('split', { ...CONTROLS, onStep });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onStep).toHaveBeenNthCalledWith(1, 1);
    expect(onStep).toHaveBeenNthCalledWith(2, -1);
  });
});
