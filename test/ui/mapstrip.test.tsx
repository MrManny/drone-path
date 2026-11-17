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

function strip(
  layout: 'split' | 'overlay',
  zoomControls: ZoomControls | undefined,
  hudHostRef: RefObject<HTMLDivElement | null>,
  visibleZoom: number,
) {
  return (
    <MapStrip
      hudHostRef={hudHostRef}
      layout={layout}
      zoomControls={zoomControls}
      visibleZoom={visibleZoom}
    />
  );
}

function renderStrip(
  layout: 'split' | 'overlay',
  zoomControls?: ZoomControls,
  hudHostRef: RefObject<HTMLDivElement | null> = { current: null },
  visibleZoom = 14,
) {
  const view = render(strip(layout, zoomControls, hudHostRef, visibleZoom));
  return { ...view, hudHostRef };
}

describe('MapStrip (#272, #287)', () => {
  it('renders the scene-owned readout host inside the strip', () => {
    const { container, hudHostRef } = renderStrip('split');
    const stripEl = container.querySelector('.map-card-strip') as HTMLElement;
    const readouts = stripEl.querySelector('.map-strip-readouts') as HTMLElement;
    expect(readouts).toBeTruthy();
    expect(hudHostRef.current).toBe(readouts);
  });

  it('mounts the labeled bare zoom stepper in split view', () => {
    renderStrip('split', CONTROLS);
    expect(screen.getByText('Zoom')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Map zoom' })).toBeTruthy();
  });

  it('renders the zoom readout column in the PiP layout (#287)', () => {
    const { container } = renderStrip('overlay', CONTROLS);
    const zoomColumn = container.querySelector('.map-strip-zoom') as HTMLElement;
    expect(zoomColumn.querySelector('.label')?.textContent).toBe('Zoom');
    expect(zoomColumn.querySelector('.map-zoom-level')).toBeTruthy();
    expect(screen.getByText('Zoom')).toBeTruthy();
  });

  it('keeps the stepper controls out of the PiP layout (#287)', () => {
    const { container } = renderStrip('overlay', CONTROLS);
    expect(container.querySelector('.map-zoom-stepper')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Map zoom' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();
  });

  it('shows a step change in the PiP readout (#287 regression)', () => {
    const { container, rerender } = renderStrip('overlay', { ...CONTROLS, zoom: 14 });
    const readout = () => container.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout().textContent).toBe('Zoom level 14');
    rerender(strip('overlay', { ...CONTROLS, zoom: 15 }, { current: null }, 15));
    expect(readout().textContent).toBe('Zoom level 15');
  });

  it('announces a refused step through the PiP live region (#287 regression)', () => {
    const { container } = renderStrip('overlay', {
      ...CONTROLS,
      zoom: 14,
      notice: 'Already zoomed all the way in',
    });
    const readout = container.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout.getAttribute('aria-live')).toBe('polite');
    expect(readout.textContent).toBe('Zoom level 14. Already zoomed all the way in');
  });

  it.for(['split', 'overlay'] as const)(
    'renders the readout host but no zoom column without zoom controls in the %s layout',
    (layout) => {
      const { container } = renderStrip(layout);
      expect(container.querySelector('.map-strip-readouts')).toBeTruthy();
      expect(container.querySelector('.map-strip-zoom')).toBeNull();
    },
  );

  it('routes step presses to the zoom controls', () => {
    const onStep = vi.fn();
    renderStrip('split', { ...CONTROLS, onStep });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onStep).toHaveBeenNthCalledWith(1, 1);
    expect(onStep).toHaveBeenNthCalledWith(2, -1);
  });
});
