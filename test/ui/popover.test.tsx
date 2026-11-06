// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Popover } from '../../ui/components/Popover.js';

afterEach(cleanup);

function renderPopover(onClose = vi.fn()) {
  const view = render(
    <Popover label="Map appearance" onClose={onClose}>
      <p>content</p>
    </Popover>,
  );
  return { ...view, onClose };
}

describe('Popover', () => {
  it('is a non-modal panel with the popover name', () => {
    renderPopover();
    const panel = screen.getByRole('dialog', { name: 'Map appearance' });
    expect(panel.classList.contains('map-popover')).toBe(true);
    expect(document.querySelector('.settings-overlay')).toBeNull();
  });

  it('takes focus on open', () => {
    renderPopover();
    const panel = screen.getByRole('dialog', { name: 'Map appearance' });
    expect(document.activeElement).toBe(panel);
  });

  it('closes from its Close button', () => {
    const { onClose } = renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click outside and keeps open on one inside', () => {
    const { onClose } = renderPopover();
    const panel = screen.getByRole('dialog', { name: 'Map appearance' });
    fireEvent.mouseDown(panel);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
