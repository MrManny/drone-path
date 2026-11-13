// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpdatePrompt } from '../../ui/components/UpdatePrompt.js';

afterEach(cleanup);

function renderPrompt(overrides: Partial<Parameters<typeof UpdatePrompt>[0]> = {}) {
  const onRestart = vi.fn();
  const onLater = vi.fn();
  render(
    <UpdatePrompt
      restarting={false}
      failure={null}
      onRestart={onRestart}
      onLater={onLater}
      {...overrides}
    />,
  );
  return { onRestart, onLater };
}

describe('UpdatePrompt', () => {
  it('opens as the Update dialog with the message and one footer action', () => {
    renderPrompt();
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'A new version is ready to install. Restart now to finish updating, or keep working and the update installs when you quit.',
    );
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
  });

  it('makes Restart now the primary action', () => {
    renderPrompt();
    const restart = screen.getByRole('button', { name: 'Restart now' });
    expect(restart.className).toBe('dialog-primary');
  });

  it('keeps exactly one dismissal control, the header ✕', () => {
    renderPrompt();
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });

  it('postpones the update on the header ✕', () => {
    const { onRestart, onLater } = renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it('restarts on Restart now', () => {
    const { onRestart, onLater } = renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onLater).not.toHaveBeenCalled();
  });

  it('locks the actions and says it is restarting once the restart runs', () => {
    renderPrompt({ restarting: true });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Restarting…' }).disabled,
    ).toBe(true);
    const close = screen.getByRole<HTMLButtonElement>('button', { name: 'Close' });
    expect(close.disabled).toBe(true);
    expect(close.getAttribute('title')).toBe('The app is restarting.');
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
  });

  it('reports a failed restart with what happened and what to do', () => {
    renderPrompt({ failure: 'spawn failed' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'The restart failed. Try again, or install the update when you quit.',
    );
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the backend message under Technical details, never as the message', () => {
    renderPrompt({ failure: 'spawn failed' });
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText('spawn failed')).toBeTruthy();
    expect(
      screen.getByText('The restart failed. Try again, or install the update when you quit.')
        .textContent,
    ).not.toContain('spawn failed');
  });
});
