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
    exportOpen: false,
    updateOpen: false,
    dismissible: true,
    dispatchDialog: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(state: PickState = { kind: 'idle' }, dialogs = fakeDialogs()) {
  const onPick = vi.fn();
  const onHelp = vi.fn();
  const onDismiss = vi.fn();
  render(
    <EmptyWorkspace
      state={state}
      onPick={onPick}
      onHelp={onHelp}
      onDismiss={onDismiss}
      dialogs={dialogs}
    />,
  );
  return { onPick, onHelp, onDismiss, dialogs };
}

describe('EmptyWorkspace skeleton', () => {
  it('keeps the five workspace rows in the player order and geometry', () => {
    renderWorkspace();
    const rows = [...(document.querySelector('.workspace') as HTMLElement).children].map(
      (row) => row.className,
    );
    expect(rows).toEqual([
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

  it('disables Export while keeping Open live in the header', () => {
    renderWorkspace();
    const header = document.querySelector('.workspace-header') as HTMLElement;
    const open = within(header).getByRole<HTMLButtonElement>('button', { name: 'Open…' });
    const exportButton = within(header).getByRole<HTMLButtonElement>('button', { name: 'Export…' });
    expect(open.disabled).toBe(false);
    expect(open.className).not.toContain('primary');
    expect(exportButton.disabled).toBe(true);
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

  it('disables map settings and swap while Help stays available', () => {
    const { onHelp } = renderWorkspace();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Map settings' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Swap' }).disabled).toBe(true);
    const help = screen.getByRole<HTMLButtonElement>('button', { name: 'Help' });
    expect(help.disabled).toBe(false);
    fireEvent.click(help);
    expect(onHelp).toHaveBeenCalledTimes(1);
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
  it('disables the header Open button while the flow prepares', () => {
    renderWorkspace({ kind: 'preparing', progress: { stage: 'probe', done: 0, total: 3 } });
    const header = document.querySelector('.workspace-header') as HTMLElement;
    expect(within(header).getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(
      true,
    );
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
