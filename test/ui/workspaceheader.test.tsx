// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceHeader } from '../../ui/components/WorkspaceHeader.js';

afterEach(cleanup);

function renderHeader(overrides: Partial<Parameters<typeof WorkspaceHeader>[0]> = {}) {
  const onOpen = vi.fn();
  const onExport = vi.fn();
  const onTelemetrySave = vi.fn();
  render(
    <WorkspaceHeader
      durationSec={3}
      opening={false}
      telemetryScope="full recording (0:03)"
      onOpen={onOpen}
      onExport={onExport}
      onTelemetrySave={onTelemetrySave}
      {...overrides}
    />,
  );
  return { onOpen, onExport, onTelemetrySave };
}

describe('WorkspaceHeader', () => {
  it('shows the wordmark and the project identity', () => {
    renderHeader();
    expect(document.querySelector('.brand')?.textContent).toBe('drone / path');
    expect(screen.getByText('Flight workspace')).toBeTruthy();
    expect(screen.getByText('Recording · 0:03')).toBeTruthy();
  });

  it.for([
    { opening: false, status: 'Video + telemetry ready' },
    { opening: false, status: 'Warming tiles…' },
    { opening: true, status: 'Preparing recording…' },
  ])('carries no readiness text ($status)', ({ opening, status }) => {
    renderHeader({ opening });
    expect(screen.queryByText(status)).toBeNull();
    expect(document.querySelector('.header-status')).toBeNull();
  });

  it('dispatches the header actions', () => {
    const { onOpen, onExport, onTelemetrySave } = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Open…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save telemetry JSON…' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onTelemetrySave).toHaveBeenCalledTimes(1);
  });

  it('places the telemetry save right of the export action', () => {
    renderHeader();
    const buttons = [...document.querySelectorAll('.workspace-header button')].map(
      (b) => b.textContent,
    );
    expect(buttons).toEqual(['Open…', 'Export…', 'Save telemetry JSON…']);
  });

  it('states the save scope in the title before the click', () => {
    renderHeader({ telemetryScope: 'In–Out segment (0:01–0:02 · 2 frames)' });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Save telemetry JSON…' });
    expect(button.title).toBe('Saves telemetry JSON for the In–Out segment (0:01–0:02 · 2 frames)');
  });

  it('holds Open while the Open flow prepares', () => {
    renderHeader({ opening: true });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(true);
  });

  it('disables Export and the telemetry save while nothing is loaded and keeps Open live', () => {
    renderHeader({ disabled: true });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Export…' }).disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save telemetry JSON…' }).disabled,
    ).toBe(true);
    const open = screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' });
    expect(open.disabled).toBe(false);
    expect(open.className).not.toContain('primary');
  });

  it('shows the zero-duration project slot and no state label', () => {
    renderHeader({ durationSec: 0, disabled: true });
    expect(screen.getByText('Recording · 0:00')).toBeTruthy();
    expect(screen.queryByText(/No recording/)).toBeNull();
  });
});
