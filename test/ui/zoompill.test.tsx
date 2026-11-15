// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZoomPill } from '../../ui/components/ZoomPill.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPill(zoom: number, visibleZoom: number, onStep = vi.fn(), notice = '') {
  const view = render(
    <ZoomPill
      zoom={zoom}
      visibleZoom={visibleZoom}
      style="satellite"
      onStep={onStep}
      notice={notice}
    />,
  );
  return { ...view, onStep };
}

describe('ZoomPill (#270)', () => {
  it('renders the step buttons in a labeled group', () => {
    renderPill(0, 15);
    expect(screen.getByRole('group', { name: 'Map zoom' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
  });

  it('carries the level inside the live announcement (#271)', () => {
    const { container } = renderPill(14, 14);
    const readout = container.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout.getAttribute('aria-live')).toBe('polite');
    expect(readout.textContent).toBe('Zoom level 14');
    expect(container.querySelector('.sr-only')?.textContent).toBe('Zoom level ');
  });

  it('shows the pinned level when zoom is pinned', () => {
    renderPill(14, 14);
    expect(screen.getByText('14')).toBeTruthy();
    expect(screen.queryByText('auto')).toBeNull();
  });

  it('shows auto while auto-fit', () => {
    renderPill(0, 15);
    expect(screen.getByText('auto')).toBeTruthy();
    expect(screen.queryByText('15')).toBeNull();
  });

  it('shows the level the map renders even for an out-of-range pin', () => {
    renderPill(25, 19);
    expect(screen.getByText('19')).toBeTruthy();
  });

  it('steps one level per press', () => {
    const { onStep } = renderPill(14, 14);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onStep).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onStep).toHaveBeenCalledWith(-1);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('shows the real key in the button titles (#271)', () => {
    renderPill(14, 14);
    expect(screen.getByRole('button', { name: 'Zoom in' }).getAttribute('title')).toBe(
      'Zoom the map in one level (+)',
    );
    expect(screen.getByRole('button', { name: 'Zoom out' }).getAttribute('title')).toBe(
      'Zoom the map out one level (-)',
    );
  });

  it('marks zooming in at the maximum disabled but keeps the button focusable (#271)', () => {
    renderPill(19, 19);
    const zoomIn = screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom in' });
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true');
    expect(zoomIn.disabled).toBe(false);
    expect(zoomIn.getAttribute('title')).toBe('Already zoomed all the way in');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' }).getAttribute(
        'aria-disabled',
      ),
    ).toBeNull();
  });

  it('marks zooming out at the floor disabled but keeps the button focusable (#271)', () => {
    renderPill(2, 2);
    const zoomOut = screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' });
    expect(zoomOut.getAttribute('aria-disabled')).toBe('true');
    expect(zoomOut.disabled).toBe(false);
    expect(zoomOut.getAttribute('title')).toBe('Already zoomed all the way out');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom in' }).getAttribute(
        'aria-disabled',
      ),
    ).toBeNull();
  });

  it('keeps both buttons live between the limits', () => {
    renderPill(0, 15);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom in' }).getAttribute(
        'aria-disabled',
      ),
    ).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' }).getAttribute(
        'aria-disabled',
      ),
    ).toBeNull();
  });

  it('routes a press at a limit through onStep so the caller can announce it (#271)', () => {
    const { onStep } = renderPill(19, 19);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('speaks a refused step through the live region (#271)', () => {
    const { container } = renderPill(19, 19, vi.fn(), 'Already zoomed all the way in');
    const readout = container.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout.textContent).toBe('Zoom level 19. Already zoomed all the way in');
  });
});
