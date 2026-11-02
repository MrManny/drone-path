// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpdatePrompt } from '../../ui/components/UpdatePrompt.js';

afterEach(cleanup);

function renderPrompt(overrides: Partial<Parameters<typeof UpdatePrompt>[0]> = {}) {
  const onRestart = vi.fn();
  const onLater = vi.fn();
  render(
    <UpdatePrompt restarting={false} onRestart={onRestart} onLater={onLater} {...overrides} />,
  );
  return { onRestart, onLater };
}

describe('UpdatePrompt', () => {
  it('opens as the Update dialog with the message and both actions', () => {
    renderPrompt();
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'A new version is ready to install. Restart now to finish updating, or keep working and the update installs when you quit.',
    );
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
  });

  it('makes Restart now the primary action', () => {
    renderPrompt();
    const restart = screen.getByRole('button', { name: 'Restart now' });
    expect(restart.className).toBe('dialog-primary');
  });

  it('postpones the update on Later', () => {
    const { onRestart, onLater } = renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
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
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Later' }).disabled).toBe(true);
    const close = screen.getByRole<HTMLButtonElement>('button', { name: 'Close' });
    expect(close.disabled).toBe(true);
    expect(close.getAttribute('title')).toBe('The app is restarting.');
    expect(screen.getByRole('dialog', { name: 'Update' })).toBeTruthy();
  });
});
