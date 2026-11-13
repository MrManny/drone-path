// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmptyWorkspace } from '../../ui/components/EmptyWorkspace.js';
import type { Dialogs } from '../../ui/hooks/useDialogs.js';
import type { PickState } from '../../ui/lib/pickstate.js';

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { createFakeScene, immediateMapIslandMock } = await import('./harness.js');
  return immediateMapIslandMock(createFakeScene());
});

afterEach(cleanup);

function fakeDialogs(overrides: Partial<Dialogs> = {}): Dialogs {
  return {
    modalOpen: false,
    helpOpen: false,
    aboutOpen: false,
    exportOpen: false,
    telemetrySaveOpen: false,
    updateOpen: false,
    dismissible: true,
    dispatchDialog: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(state: PickState = { kind: 'idle' }, dialogs = fakeDialogs()) {
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
  it('keeps the six workspace rows in the player order and geometry', () => {
    renderWorkspace();
    const rows = [...(document.querySelector('.workspace') as HTMLElement).children].map(
      (row) => row.className,
    );
    expect(rows).toEqual([
      'menu-bar',
      'workspace-header',
      'stage stage-split',
      'transport',
      'timeline',
      'status-bar',
    ]);
  });

  it('carries the one quiet state message and the map placeholder', () => {
    renderWorkspace();
    expect(screen.getByText('No recording loaded')).toBeTruthy();
    expect(screen.getByText('No telemetry yet')).toBeTruthy();
    expect(screen.queryByText('SRT telemetry loaded')).toBeNull();
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
    for (const name of ['Export video…', 'Export telemetry…', 'Settings']) {
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
    for (const name of ['Set loop in', 'Set loop out', 'Clear loop']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
  });

  it('disables Settings and Swap in the menu while Documentation stays available', () => {
    const { onHelp, onExit } = renderWorkspace();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(
      within(menu()).getByRole('menuitem', { name: 'Settings' }).getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(
      within(menu()).getByRole('menuitem', { name: 'Swap' }).getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Documentation' }));
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
    { name: 'S', key: 's' },
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
    expect(screen.getByRole('alert').textContent).toContain('Could not open the recording: boom');
    expect(document.querySelector('.workspace')).not.toBeNull();
  });
});
