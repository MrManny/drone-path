// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExportRunningProps } from '../../ui/components/ExportRunning.js';
import { ExportRunning } from '../../ui/components/ExportRunning.js';

afterEach(cleanup);

function renderRunning(overrides: Partial<ExportRunningProps> = {}) {
  const onCancel = overrides.onCancel ?? vi.fn();
  render(
    <ExportRunning
      fraction={null}
      canceling={false}
      error={null}
      {...overrides}
      onCancel={onCancel}
    />,
  );
  return { onCancel };
}

describe('ExportRunning progress bar', () => {
  it('shimmers before any capture progress', () => {
    renderRunning();
    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect((bar.firstElementChild as HTMLElement).className).toContain('progress-shimmer');
  });

  it('fills determinately from the typed capture fraction', () => {
    renderRunning({ fraction: 0.83 });
    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('83');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('83%');
  });

  it('keeps the last level while the cancel is in flight', () => {
    renderRunning({ fraction: 0.5, canceling: true });
    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });
});

describe('ExportRunning cancel action', () => {
  it('calls back on Cancel export', () => {
    const { onCancel } = renderRunning();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('marks Cancel export as the phase action', () => {
    renderRunning();
    expect(
      screen.getByRole('button', { name: 'Cancel export' }).hasAttribute('data-phase-focus'),
    ).toBe(true);
  });

  it('disables Cancel export while canceling', () => {
    renderRunning({ canceling: true });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel export' }).disabled).toBe(true);
  });

  it('shows why a cancel failed', () => {
    renderRunning({ error: 'the app backend went away' });
    expect(screen.getByText('the app backend went away')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel export' }).disabled).toBe(false);
  });
});
