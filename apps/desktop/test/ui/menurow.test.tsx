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
    const row = screen.getByRole('menuitem', { name: 'Open…' });
    expect(row.querySelector('.menu-item-icon')?.contains(screen.getByTestId('icon'))).toBe(true);
    expect(row.querySelector('.menu-item-label')?.textContent).toBe('Open…');
    const hint = row.querySelector('.menu-item-hint');
    expect(hint?.textContent).toBe('Ctrl+O');
    expect(hint?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a menuitem that reports its disabled state', () => {
    renderRow();
    const row = screen.getByRole('menuitem', { name: 'Open…' });
    expect(row.getAttribute('aria-disabled')).toBeNull();
    cleanup();
    renderRow({ disabled: true });
    expect(screen.getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('keeps the shortcut out of the accessible name but announces it', () => {
    renderRow({ label: 'Toggle PiP', hint: 'P' });
    const row = screen.getByRole('menuitem', { name: 'Toggle PiP' });
    expect(row.getAttribute('aria-keyshortcuts')).toBe('P');
  });

  it('maps Ctrl hints to ARIA key shortcuts', () => {
    renderRow();
    expect(screen.getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-keyshortcuts')).toBe(
      'Control+O',
    );
  });

  it('marks the active row and carries its selection bar', () => {
    renderRow({ active: true });
    const row = screen.getByRole('menuitem', { name: 'Open…' });
    expect(row.className).toContain('active');
    expect(row.querySelector('.menu-selbar')).toBeTruthy();
  });

  it('reports hover and activation', () => {
    const { onHover, onActivate } = renderRow();
    const row = screen.getByRole('menuitem', { name: 'Open…' });
    fireEvent.mouseEnter(row);
    fireEvent.click(row);
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('stays focusable but inert when disabled', () => {
    const { onHover, onActivate } = renderRow({ disabled: true, active: false });
    const row = screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Open…' });
    // aria-disabled instead of the disabled attribute: the row holds the
    // keyboard focus so its disabled state gets announced.
    expect(row.disabled).toBe(false);
    expect(row.tabIndex).toBe(-1);
    row.focus();
    expect(document.activeElement).toBe(row);
    fireEvent.mouseEnter(row);
    fireEvent.click(row);
    expect(onHover).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('states the tooltip it was given', () => {
    renderRow({ title: 'Export telemetry for the full recording (0:03)' });
    expect(screen.getByRole('menuitem', { name: 'Open…' }).title).toBe(
      'Export telemetry for the full recording (0:03)',
    );
  });
});
