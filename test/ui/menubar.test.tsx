// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MenuBarProps } from '../../ui/components/MenuBar.js';
import { MenuBar } from '../../ui/components/MenuBar.js';

afterEach(cleanup);

function renderBar(overrides: Partial<MenuBarProps> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onExportVideo: vi.fn(),
    onExportTelemetry: vi.fn(),
    onSettings: vi.fn(),
    onSwap: vi.fn(),
    onDocumentation: vi.fn(),
    onExit: vi.fn(),
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
  fireEvent.click(screen.getByRole('button', { name: 'File' }));
}

describe('MenuBar', () => {
  it('shows File and View left and Help right-aligned', () => {
    renderBar();
    const labels = [...document.querySelectorAll('.menu-bar-label')].map((b) => b.textContent);
    expect(labels).toEqual(['File', 'View', 'Help']);
    const slots = [...document.querySelectorAll('.menu-bar-slot')];
    expect(slots[slots.length - 1].className).toContain('end');
  });

  it('opens the File dropdown on its label and closes it on a second click', () => {
    renderBar();
    const file = screen.getByRole('button', { name: 'File' });
    fireEvent.click(file);
    expect(file.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'File' })).toBeTruthy();
    fireEvent.click(file);
    expect(screen.queryByRole('group', { name: 'File' })).toBeNull();
  });

  it('runs the item flows and closes the menu', () => {
    const handlers = renderBar();
    openFile();
    fireEvent.click(screen.getByRole('button', { name: 'Open…' }));
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'File' })).toBeNull();

    openFile();
    fireEvent.click(screen.getByRole('button', { name: 'Export video…' }));
    expect(handlers.onExportVideo).toHaveBeenCalledTimes(1);

    openFile();
    fireEvent.click(screen.getByRole('button', { name: 'Export telemetry…' }));
    expect(handlers.onExportTelemetry).toHaveBeenCalledTimes(1);

    openFile();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(handlers.onSettings).toHaveBeenCalledTimes(1);

    openFile();
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(handlers.onExit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    expect(handlers.onSwap).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'Documentation' }));
    expect(handlers.onDocumentation).toHaveBeenCalledTimes(1);
  });

  it('disables the recording-bound items without a recording', () => {
    renderBar({ hasRecording: false });
    openFile();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Export video…' }).disabled).toBe(
      true,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Export telemetry…' }).disabled,
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Settings' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Exit' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Swap' }).disabled).toBe(true);
  });

  it('holds Open while a recording is opening', () => {
    renderBar({ opening: true });
    openFile();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Exit' }).disabled).toBe(false);
  });

  it('passes item tooltips through to the rows', () => {
    renderBar({ itemTitles: { exportTelemetry: 'Exports telemetry for the full recording (0:03)' } });
    openFile();
    expect(screen.getByRole('button', { name: 'Export telemetry…' }).title).toBe(
      'Exports telemetry for the full recording (0:03)',
    );
  });

  it('switches open menus on label hover and closes on an outside click', () => {
    renderBar();
    openFile();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
  });

  it('opens File on a bare Alt press-and-release and reports the open state', () => {
    const handlers = renderBar();
    pressKey({ key: 'Alt' });
    releaseKey({ key: 'Alt' });
    expect(screen.getByRole('group', { name: 'File' })).toBeTruthy();
    expect(handlers.onMenuOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('opens menus on their Alt mnemonics', () => {
    renderBar();
    pressKey({ key: 'h', altKey: true });
    expect(screen.getByRole('group', { name: 'Help' })).toBeTruthy();
  });

  it('walks the rows with the keyboard and activates the highlighted one', () => {
    const handlers = renderBar();
    pressKey({ key: 'f', altKey: true });
    pressKey({ key: 'ArrowDown' });
    pressKey({ key: 'Enter' });
    expect(handlers.onExportVideo).toHaveBeenCalledTimes(1);
    expect(handlers.onMenuOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('closes on Escape without running anything', () => {
    const handlers = renderBar();
    pressKey({ key: 'f', altKey: true });
    pressKey({ key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'File' })).toBeNull();
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(handlers.onExit).not.toHaveBeenCalled();
  });
});
