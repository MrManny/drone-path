// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZoomPill } from '../../ui/components/ZoomPill.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPill(zoom: number, visibleZoom: number, onStep = vi.fn()) {
  const view = render(
    <ZoomPill zoom={zoom} visibleZoom={visibleZoom} style="satellite" onStep={onStep} />,
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

  it('names the readout for screen readers while the level stays visible', () => {
    const { container } = renderPill(14, 14);
    expect(screen.getByText('14')).toBeTruthy();
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

  it('carries the shortcut hint in the button titles', () => {
    renderPill(14, 14);
    expect(screen.getByRole('button', { name: 'Zoom in' }).getAttribute('title')).toBe('Zoom in (+)');
    expect(screen.getByRole('button', { name: 'Zoom out' }).getAttribute('title')).toBe(
      'Zoom out (−)',
    );
  });

  it('disables zooming in at the maximum and states why', () => {
    renderPill(19, 19);
    const zoomIn = screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom in' });
    expect(zoomIn.disabled).toBe(true);
    expect(zoomIn.getAttribute('title')).toBe('Already at the closest zoom');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' }).disabled).toBe(false);
  });

  it('disables zooming out at the floor and states why', () => {
    renderPill(2, 2);
    const zoomOut = screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' });
    expect(zoomOut.disabled).toBe(true);
    expect(zoomOut.getAttribute('title')).toBe('Already at the farthest zoom');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom in' }).disabled).toBe(false);
  });

  it('keeps both buttons live between the limits', () => {
    renderPill(0, 15);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom in' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' }).disabled).toBe(false);
  });
});
