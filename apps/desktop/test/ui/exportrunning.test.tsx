// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExportRunningProps } from '../../ui/components/ExportRunning.js';
import { ExportRunning } from '../../ui/components/ExportRunning.js';

afterEach(cleanup);

function renderRunning(overrides: Partial<ExportRunningProps> = {}) {
  render(<ExportRunning fraction={null} error={null} {...overrides} />);
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

  it('shows why a cancel failed', () => {
    renderRunning({ error: { code: 'BACKEND_ERROR', detail: 'the app backend went away' } });
    expect(screen.getByText('BACKEND_ERROR: the app backend went away')).toBeTruthy();
  });
});
