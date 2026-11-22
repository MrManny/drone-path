// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyWorkspace } from '../../ui/components/EmptyWorkspace.js';
import type { Dialogs } from '../../ui/hooks/useDialogs.js';
import type { PickState } from '../../ui/lib/pickstate.js';
import { installResizeObserverStub } from './harness.js';

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { createFakeScene, immediateMapIslandMock } = await import('./harness.js');
  return immediateMapIslandMock(createFakeScene());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  installResizeObserverStub();
});

function fakeDialogs(overrides: Partial<Dialogs> = {}): Dialogs {
  return {
    active: 'closed',
    modalOpen: false,
    dismissible: true,
    dispatchDialog: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(
  state: PickState = { kind: 'idle' },
  dialogs = fakeDialogs(),
) {
  const onPick = vi.fn();
  const onHelp = vi.fn();
  const onExit = vi.fn();
  const onDismiss = vi.fn();
  render(
    <EmptyWorkspace
      state={state}
      onPick={onPick}
      onHelp={onHelp}
      onExit={onExit}
      onDismiss={onDismiss}
      dialogs={dialogs}
    />,
  );
  return { onPick, onHelp, onExit, onDismiss, dialogs };
}

function menu(): HTMLElement {
  return document.querySelector('.menu-bar') as HTMLElement;
}

describe('EmptyWorkspace skeleton', () => {
  it('keeps the five workspace rows in the player order and geometry with a main landmark (#411)', () => {
    renderWorkspace();
    const chrome = [...(document.querySelector('.workspace') as HTMLElement).children].map(
      (row) => row.className,
    );
    expect(chrome).toEqual(['menu-bar', 'workspace-header', 'workspace-main']);
    const main = screen.getByRole('main');
    expect(main.className).toBe('workspace-main');
    expect([...main.children].map((row) => row.className)).toEqual([
      'stage stage-split',
      'transport',
      'timeline',
    ]);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Flight workspace' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Timeline' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeTruthy();
    expect(document.querySelector('.status-bar')).toBeNull();
  });

  it('carries the map placeholder with no status footer', () => {
    renderWorkspace();
    expect(screen.getByText('No flight path yet.')).toBeTruthy();
    expect(screen.queryByText('No recording loaded')).toBeNull();
    expect(screen.queryByText(/Recording ·/)).toBeNull();
    expect(document.querySelector('.status-bar')).toBeNull();
    expect(screen.queryByText(/Warming tiles/)).toBeNull();
  });

  it('holds the open call to action as the only accent fill', () => {
    renderWorkspace();
    const primaries = document.querySelectorAll('button.primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toContain('Open…');
  });

  it('disables the recording-bound menu items while keeping Open live', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    const open = within(menu()).getByRole('menuitem', { name: 'Open…' });
    expect(open.getAttribute('aria-disabled')).toBeNull();
    for (const name of ['Export video…', 'Export telemetry…']) {
      expect(within(menu()).getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe(
        'true',
      );
    }
    expect(within(menu()).getByRole('menuitem', { name: 'Exit' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('disables the transport cluster and the speed group', () => {
    renderWorkspace();
    for (const name of ['Jump to start', 'Play', 'Jump to end', '1×', '2×', '3×', '4×']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
  });

  it('disables the scrubber and the loop controls with no filmstrip', () => {
    renderWorkspace();
    expect(screen.queryByTestId('filmstrip')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('slider', { name: 'Playback position' }).disabled).toBe(
      true,
    );
    for (const name of ['Set in point', 'Set out point', 'Clear in and out points']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
  });

  it('keeps Map appearance and Help live while Picture in picture stays disabled', () => {
    const { onHelp, onExit } = renderWorkspace();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(
      within(menu()).getByRole('menuitem', { name: 'Map appearance…' }).getAttribute('aria-disabled'),
    ).toBeNull();
    expect(
      within(menu()).getByRole('menuitem', { name: 'Picture in picture' }).getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'User manual' }),
    );
    expect(onHelp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Exit' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('opens About from the Help menu without a recording', () => {
    const { dialogs } = renderWorkspace();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    const about = within(menu()).getByRole('menuitem', { name: 'About' });
    expect(about.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(about);
    expect(dialogs.dispatchDialog).toHaveBeenCalledWith({ type: 'openAbout' });
  });
});

describe('EmptyWorkspace keyboard', () => {
  it('opens a recording with Ctrl+O', () => {
    const { onPick } = renderWorkspace();
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it.for([
    { name: 'Space', key: ' ' },
    { name: 'K', key: 'k' },
    { name: 'Left', key: 'ArrowLeft' },
    { name: 'Right', key: 'ArrowRight' },
    { name: 'Home', key: 'Home' },
    { name: 'End', key: 'End' },
    { name: 'I', key: 'i' },
    { name: 'O', key: 'o' },
    { name: 'P', key: 'p' },
    { name: '2', key: '2' },
  ])('lets the $name playback shortcut no-op until a recording loads', ({ key }) => {
    const { onPick, onHelp } = renderWorkspace();
    fireEvent.keyDown(window, { key });
    expect(onPick).not.toHaveBeenCalled();
    expect(onHelp).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes a modal overlay with Escape', () => {
    const { dialogs } = renderWorkspace({ kind: 'idle' }, fakeDialogs({ modalOpen: true }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialogs.dispatchDialog).toHaveBeenCalledWith({ type: 'close' });
  });

  it('keeps Escape quiet when nothing is open', () => {
    const { dialogs } = renderWorkspace();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialogs.dispatchDialog).not.toHaveBeenCalled();
  });
});

describe('EmptyWorkspace open states', () => {
  it('disables the menu Open item while the flow prepares', () => {
    renderWorkspace({ kind: 'preparing', progress: { stage: 'probe', done: 0, total: 3 } });
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(
      within(menu()).getByRole('menuitem', { name: 'Open…' }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      within(menu()).getByRole('menuitem', { name: 'Exit' }).getAttribute('aria-disabled'),
    ).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Preparing…' }).disabled).toBe(
      true,
    );
  });

  it('shows the stage notice for a failed open', () => {
    renderWorkspace({ kind: 'error', message: 'boom' });
    expect(screen.getByRole('alert').textContent).toContain(
      'Could not open the recording: Something went wrong. Try again.',
    );
    expect(screen.getByText('boom')).toBeTruthy();
    expect(document.querySelector('.workspace')).not.toBeNull();
  });
});

describe('EmptyWorkspace map appearance', () => {
  function openMapAppearance() {
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Map appearance…' }));
  }

  it('asks for the Map appearance dialog from the View menu with no recording loaded (#236)', () => {
    const { dialogs } = renderWorkspace();
    openMapAppearance();
    expect(dialogs.dispatchDialog).toHaveBeenCalledWith({ type: 'openMapAppearance' });
  });

  it('closes with Escape through the dialog state machine', () => {
    const { dialogs } = renderWorkspace(
      { kind: 'idle' },
      fakeDialogs({ active: 'map-appearance', modalOpen: true }),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialogs.dispatchDialog).toHaveBeenCalledWith({ type: 'close' });
  });
});
