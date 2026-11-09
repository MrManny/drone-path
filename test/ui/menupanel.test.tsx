// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MenuPanelProps } from '../../ui/components/MenuPanel.js';
import { MenuPanel } from '../../ui/components/MenuPanel.js';
import type { MenuFlags } from '../../ui/lib/menumodel.js';
import { menuOf } from '../../ui/lib/menumodel.js';

afterEach(cleanup);

const LOADED: MenuFlags = { hasRecording: true, opening: false };
const EMPTY: MenuFlags = { hasRecording: false, opening: false };

function renderPanel(overrides: Partial<MenuPanelProps> = {}) {
  const onHoverRow = vi.fn();
  const onActivateRow = vi.fn();
  render(
    <MenuPanel
      menu={menuOf('file')}
      active={null}
      flags={LOADED}
      onHoverRow={onHoverRow}
      onActivateRow={onActivateRow}
      {...overrides}
    />,
  );
  return { onHoverRow, onActivateRow };
}

describe('MenuPanel', () => {
  it('lays the File rows out in acceptance order with separators', () => {
    renderPanel();
    const panel = screen.getByRole('menu', { name: 'File' });
    const rows = [...panel.querySelectorAll('.menu-row')].map((row) => row.textContent);
    expect(rows).toEqual([
      'Open…Ctrl+O',
      'Export video…',
      'Export telemetry…',
      'Settings',
      'Exit',
    ]);
    const order = [...panel.querySelectorAll('.menu-row, .menu-separator')].map((el) =>
      el.classList.contains('menu-separator') ? '—' : (el.textContent ?? ''),
    );
    expect(order).toEqual([
      'Open…Ctrl+O',
      'Export video…',
      'Export telemetry…',
      '—',
      'Settings',
      '—',
      'Exit',
    ]);
  });

  it('disables the recording-bound rows without a recording and keeps the rest live', () => {
    renderPanel({ flags: EMPTY });
    const panel = screen.getByRole('menu', { name: 'File' });
    const state = Object.fromEntries(
      [...panel.querySelectorAll<HTMLButtonElement>('.menu-row')].map((row) => [
        row.textContent,
        row.disabled,
      ]),
    );
    expect(state).toEqual({
      'Open…Ctrl+O': false,
      'Export video…': true,
      'Export telemetry…': true,
      Settings: true,
      Exit: false,
    });
  });

  it('marks only the active row', () => {
    renderPanel({ active: 1 });
    const panel = screen.getByRole('menu', { name: 'File' });
    const active = [...panel.querySelectorAll('.menu-row.active')].map((row) => row.textContent);
    expect(active).toEqual(['Export video…']);
  });

  it('reports the hovered and clicked row index', () => {
    const { onHoverRow, onActivateRow } = renderPanel();
    const panel = screen.getByRole('menu', { name: 'File' });
    const rows = [...panel.querySelectorAll('.menu-row')];
    fireEvent.mouseEnter(rows[2]);
    fireEvent.click(rows[2]);
    expect(onHoverRow).toHaveBeenCalledWith(2);
    expect(onActivateRow).toHaveBeenCalledWith(2);
  });

  it('passes per-item tooltips through', () => {
    renderPanel({ titles: { exportTelemetry: 'Exports telemetry for the full recording (0:03)' } });
    expect(screen.getByRole('menuitem', { name: 'Export telemetry…' }).title).toBe(
      'Exports telemetry for the full recording (0:03)',
    );
    expect(screen.getByRole('menuitem', { name: 'Export video…' }).title).toBe('');
  });
});
