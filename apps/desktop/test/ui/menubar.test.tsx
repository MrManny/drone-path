// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MenuBarProps } from '../../ui/components/MenuBar.js';
import { MenuBar } from '../../ui/components/MenuBar.js';

afterEach(cleanup);

function renderBar(overrides: Partial<MenuBarProps> = {}) {
  const handlers = {
    onActivate: vi.fn(),
    onMenuOpenChange: vi.fn(),
  };
  render(
    <MenuBar
      hasRecording
      opening={false}
      modalOpen={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

function pressKey(init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

function releaseKey(init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }));
  });
}

function openFile(): void {
  fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
}

function fileRows(): HTMLElement[] {
  return within(screen.getByRole('menu', { name: 'File' })).getAllByRole('menuitem');
}

describe('MenuBar', () => {
  it('shows File and View left and Help right-aligned', () => {
    renderBar();
    const labels = [...document.querySelectorAll('.menu-bar-label')].map((b) => b.textContent);
    expect(labels).toEqual(['File', 'View', 'Help']);
    const slots = [...document.querySelectorAll('.menu-bar-slot')];
    expect(slots[slots.length - 1].className).toContain('end');
  });

  it('carries the ARIA menubar structure', () => {
    renderBar();
    expect(screen.getByRole('menubar')).toBeTruthy();
    const file = screen.getByRole('menuitem', { name: 'File' });
    expect(file.getAttribute('aria-haspopup')).toBe('menu');
    expect(file.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(file);
    expect(file.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('menu', { name: 'File' });
    const names = within(panel)
      .getAllByRole('menuitem')
      .map((row) => row.textContent);
    expect(names).toEqual(['Open…Ctrl+O', 'Export video…', 'Export telemetry…', 'Exit']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    const viewNames = within(screen.getByRole('menu', { name: 'View' }))
      .getAllByRole('menuitem')
      .map((row) => row.textContent);
    expect(viewNames).toEqual(['Map appearance…', 'Picture in pictureP', 'Settings…']);
  });

  it('marks disabled rows with aria-disabled', () => {
    renderBar({ hasRecording: false });
    openFile();
    const row = screen.getByRole('menuitem', { name: 'Export video…' });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('opens the File dropdown on its label and closes it on a second click', () => {
    renderBar();
    const file = screen.getByRole('menuitem', { name: 'File' });
    fireEvent.click(file);
    expect(screen.getByRole('menu', { name: 'File' })).toBeTruthy();
    fireEvent.click(file);
    expect(screen.queryByRole('menu', { name: 'File' })).toBeNull();
  });

  it('runs the item flows and closes the menu', () => {
    const handlers = renderBar();
    openFile();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open…' }));
    expect(screen.queryByRole('menu', { name: 'File' })).toBeNull();

    openFile();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export video…' }));

    openFile();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export telemetry…' }));

    openFile();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exit' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Map appearance…' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Picture in picture' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Help' })).getByRole('menuitem', { name: 'User manual' }),
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));
    expect(handlers.onActivate.mock.calls.map(([item]) => item)).toEqual([
      'open',
      'exportVideo',
      'exportTelemetry',
      'exit',
      'settings',
      'swap',
      'documentation',
      'about',
    ]);
  });

  it('marks the recording-bound rows disabled without a recording', () => {
    renderBar({ hasRecording: false });
    openFile();
    for (const name of ['Export video…', 'Export telemetry…']) {
      expect(screen.getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Exit' }).getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(
      screen.getByRole('menuitem', { name: 'Map appearance…' }).getAttribute('aria-disabled'),
    ).toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'Picture in picture' }).getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    expect(screen.getByRole('menuitem', { name: 'About' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('holds Open while a recording is opening', () => {
    renderBar({ opening: true });
    openFile();
    expect(screen.getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByRole('menuitem', { name: 'Exit' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('passes item tooltips through to the rows', () => {
    renderBar({ itemTitles: { exportTelemetry: 'Export telemetry for the full recording (0:03)' } });
    openFile();
    expect(screen.getByRole('menuitem', { name: 'Export telemetry…' }).title).toBe(
      'Export telemetry for the full recording (0:03)',
    );
  });

  it('switches open menus on label hover and closes on an outside click', () => {
    renderBar();
    openFile();
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.getByRole('menu', { name: 'View' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull();
  });

  it('keeps one highlighted row when the mouse and the keyboard mix', () => {
    renderBar();
    openFile();
    const rows = fileRows();
    fireEvent.mouseEnter(rows[0]);
    expect(document.querySelectorAll('.menu-row.active')).toHaveLength(1);
    expect(rows[0].className).toContain('active');
    pressKey({ key: 'ArrowDown' });
    const active = [...document.querySelectorAll('.menu-row.active')];
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(rows[1]);
    expect(rows[0].className).not.toContain('active');
  });

  it('moves DOM focus with the live row so screen readers announce it', () => {
    renderBar();
    pressKey({ key: 'f', altKey: true });
    const rows = fileRows();
    expect(document.activeElement).toBe(rows[0]);
    pressKey({ key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
  });

  it('returns focus to the label when the menu closes', () => {
    renderBar();
    pressKey({ key: 'f', altKey: true });
    pressKey({ key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'File' }));
  });

  it('opens File on a bare Alt press-and-release and reports the open state', () => {
    const handlers = renderBar();
    pressKey({ key: 'Alt' });
    releaseKey({ key: 'Alt' });
    expect(screen.getByRole('menu', { name: 'File' })).toBeTruthy();
    expect(handlers.onMenuOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('opens menus on their Alt mnemonics', () => {
    renderBar();
    pressKey({ key: 'h', altKey: true });
    expect(screen.getByRole('menu', { name: 'Help' })).toBeTruthy();
  });

  it('reaches About with the keyboard, under its separator', () => {
    const handlers = renderBar();
    pressKey({ key: 'h', altKey: true });
    expect(within(screen.getByRole('menu', { name: 'Help' })).getAllByRole('separator')).toHaveLength(
      1,
    );
    pressKey({ key: 'ArrowDown' });
    pressKey({ key: 'Enter' });
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onActivate).toHaveBeenCalledWith('about');
    expect(handlers.onMenuOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('walks the rows with the keyboard and activates the highlighted one', () => {
    const handlers = renderBar();
    pressKey({ key: 'f', altKey: true });
    pressKey({ key: 'ArrowDown' });
    pressKey({ key: 'Enter' });
    expect(handlers.onActivate).toHaveBeenCalledWith('exportVideo');
    expect(handlers.onMenuOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('closes on Escape without running anything', () => {
    const handlers = renderBar();
    pressKey({ key: 'f', altKey: true });
    pressKey({ key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'File' })).toBeNull();
    expect(handlers.onActivate).not.toHaveBeenCalled();
  });
});

describe('MenuBar APG keyboard model (#238)', () => {
  function labels(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('.menu-bar-label')];
  }

  it('has an accessible name and a single Tab stop', () => {
    renderBar();
    expect(screen.getByRole('menubar', { name: 'Main menu' })).toBeTruthy();
    expect(labels().map((label) => label.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves the label focus and the Tab stop with the arrows', () => {
    renderBar();
    const [file, view, help] = labels();
    file.focus();
    fireEvent.keyDown(file, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(view);
    expect(labels().map((label) => label.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(view, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(file);
    expect(labels().map((label) => label.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.keyDown(file, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(help);
  });

  it('keeps focus on a disabled row so it gets announced', () => {
    renderBar({ hasRecording: false });
    pressKey({ key: 'f', altKey: true });
    const rows = fileRows();
    pressKey({ key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].getAttribute('aria-disabled')).toBe('true');
    pressKey({ key: 'Enter' });
    expect(screen.queryByRole('menu', { name: 'File' })).toBeTruthy();
  });

  it('closes the open menu on Tab and hands back normal navigation', () => {
    renderBar();
    pressKey({ key: 'f', altKey: true });
    const rows = fileRows();
    expect(document.activeElement).toBe(rows[0]);
    // Unclaimed by the menu: the browser keeps its own tab order for the key.
    expect(fireEvent.keyDown(rows[0], { key: 'Tab' })).toBe(true);
    expect(screen.queryByRole('menu', { name: 'File' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'File' }));
  });

  it('closes the open menu when focus leaves the bar', () => {
    renderBar();
    pressKey({ key: 'f', altKey: true });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    fireEvent.blur(fileRows()[0], { relatedTarget: outside });
    expect(screen.queryByRole('menu', { name: 'File' })).toBeNull();
    outside.remove();
  });

  it.for(['ArrowDown', 'Enter', ' '])(
    'opens the focused menubar button on %s and focuses item 0 (#406)',
    (pressed) => {
      renderBar();
      const [, view] = labels();
      fireEvent.focus(view);
      fireEvent.keyDown(view, { key: pressed });
      const rows = within(screen.getByRole('menu', { name: 'View' })).getAllByRole('menuitem');
      expect(document.activeElement).toBe(rows[0]);
    },
  );

  it('opens the focused menubar button on ArrowUp and focuses the last item (#406)', () => {
    renderBar();
    const [file] = labels();
    file.focus();
    fireEvent.keyDown(file, { key: 'ArrowUp' });
    const rows = fileRows();
    expect(document.activeElement).toBe(rows[rows.length - 1]);
  });

  it('moves the closed menubar focus to first/last label on Home and End (#406)', () => {
    renderBar();
    const [file, , help] = labels();
    file.focus();
    fireEvent.keyDown(file, { key: 'End' });
    expect(document.activeElement).toBe(help);
    expect(labels().map((label) => label.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(help, { key: 'Home' });
    expect(document.activeElement).toBe(file);
    expect(labels().map((label) => label.tabIndex)).toEqual([0, -1, -1]);
  });

  it('jumps to the first and last enabled item on Home and End inside an open menu (#406)', () => {
    renderBar({ hasRecording: true, opening: false });
    pressKey({ key: 'f', altKey: true });
    const rows = fileRows();
    pressKey({ key: 'End' });
    expect(document.activeElement).toBe(rows[3]);
    pressKey({ key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('skips disabled leading rows on Home when opening a recording (#406)', () => {
    renderBar({ hasRecording: true, opening: true });
    pressKey({ key: 'f', altKey: true });
    const rows = fileRows();
    expect(rows[0].getAttribute('aria-disabled')).toBe('true');
    pressKey({ key: 'Home' });
    expect(document.activeElement).toBe(rows[3]);
  });
});
