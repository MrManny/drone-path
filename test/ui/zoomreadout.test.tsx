// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ZoomReadout } from '../../ui/components/ZoomReadout.js';

afterEach(() => {
  cleanup();
});

function renderReadout(zoom: number, visibleZoom: number, notice = '') {
  return render(<ZoomReadout zoom={zoom} visibleZoom={visibleZoom} notice={notice} />);
}

describe('ZoomReadout (#287)', () => {
  it('carries the level inside a polite atomic live region', () => {
    const { container } = renderReadout(14, 14);
    const readout = container.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout.getAttribute('aria-live')).toBe('polite');
    expect(readout.getAttribute('aria-atomic')).toBe('true');
    expect(readout.textContent).toBe('Zoom level 14');
    expect(container.querySelector('.sr-only')?.textContent).toBe('Zoom level ');
  });

  it('shows the pinned level when zoom is pinned', () => {
    const { getByText, queryByText } = renderReadout(14, 14);
    expect(getByText('14')).toBeTruthy();
    expect(queryByText('auto')).toBeNull();
  });

  it('shows auto-fit while auto-fit', () => {
    const { getByText, queryByText } = renderReadout(0, 15);
    expect(getByText('auto-fit')).toBeTruthy();
    expect(queryByText('15')).toBeNull();
  });

  it('shows the level the map renders even for an out-of-range pin', () => {
    const { getByText } = renderReadout(25, 19);
    expect(getByText('19')).toBeTruthy();
  });

  it('speaks a refused step through the live region (#287 regression)', () => {
    const { container } = renderReadout(19, 19, 'Already zoomed all the way in');
    const readout = container.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout.textContent).toBe('Zoom level 19. Already zoomed all the way in');
    // The reason stays hidden copy: every word of it lives in sr-only spans,
    // so it can never surface as visible text in the strip.
    const hidden = Array.from(readout.querySelectorAll('.sr-only'), (el) => el.textContent);
    expect(hidden).toEqual(['Zoom level ', '. Already zoomed all the way in']);
  });

  it('drops the reason again when the notice clears', () => {
    const { container, rerender } = renderReadout(19, 19, 'Already zoomed all the way in');
    rerender(<ZoomReadout zoom={19} visibleZoom={19} />);
    const readout = container.querySelector('.map-zoom-level') as HTMLElement;
    expect(readout.textContent).toBe('Zoom level 19');
    expect(readout.textContent).not.toContain('Already zoomed');
  });

  it('renders no notice slot without a refused step', () => {
    const { container } = renderReadout(14, 14);
    expect(container.querySelectorAll('.sr-only')).toHaveLength(1);
  });
});
