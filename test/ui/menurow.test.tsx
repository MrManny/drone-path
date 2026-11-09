// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MenuRowProps } from '../../ui/components/MenuRow.js';
import { MenuRow } from '../../ui/components/MenuRow.js';

afterEach(cleanup);

function renderRow(overrides: Partial<MenuRowProps> = {}) {
  const onHover = vi.fn();
  const onActivate = vi.fn();
  render(
    <MenuRow
      label="Open…"
      hint="Ctrl+O"
      icon={<svg data-testid="icon" />}
      active={false}
      disabled={false}
      onHover={onHover}
      onActivate={onActivate}
      {...overrides}
    />,
  );
  return { onHover, onActivate };
}

describe('MenuRow', () => {
  it('shows the label, icon and right-aligned hint', () => {
    renderRow();
    const row = screen.getByRole('button', { name: 'Open…' });
    expect(row.querySelector('.menu-item-icon')?.contains(screen.getByTestId('icon'))).toBe(true);
    expect(row.querySelector('.menu-item-label')?.textContent).toBe('Open…');
    const hint = row.querySelector('.menu-item-hint');
    expect(hint?.textContent).toBe('Ctrl+O');
    expect(hint?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the shortcut out of the accessible name but announces it', () => {
    renderRow({ label: 'Swap', hint: 'S' });
    const row = screen.getByRole('button', { name: 'Swap' });
    expect(row.getAttribute('aria-keyshortcuts')).toBe('S');
  });

  it('maps Ctrl hints to ARIA key shortcuts', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Open…' }).getAttribute('aria-keyshortcuts')).toBe(
      'Control+O',
    );
  });

  it('marks the active row and carries its selection bar', () => {
    renderRow({ active: true });
    const row = screen.getByRole('button', { name: 'Open…' });
    expect(row.className).toContain('active');
    expect(row.querySelector('.menu-selbar')).toBeTruthy();
  });

  it('reports hover and activation', () => {
    const { onHover, onActivate } = renderRow();
    const row = screen.getByRole('button', { name: 'Open…' });
    fireEvent.mouseEnter(row);
    fireEvent.click(row);
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('uses the button:disabled treatment and stays inert when disabled', () => {
    const { onHover, onActivate } = renderRow({ disabled: true, active: false });
    const row = screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' });
    expect(row.disabled).toBe(true);
    fireEvent.mouseEnter(row);
    fireEvent.click(row);
    expect(onHover).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('states the tooltip it was given', () => {
    renderRow({ title: 'Exports telemetry for the full recording (0:03)' });
    expect(screen.getByRole('button', { name: 'Open…' }).title).toBe(
      'Exports telemetry for the full recording (0:03)',
    );
  });
});
