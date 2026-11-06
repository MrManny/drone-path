// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceHeader } from '../../ui/components/WorkspaceHeader.js';

afterEach(cleanup);

function renderHeader(overrides: Partial<Parameters<typeof WorkspaceHeader>[0]> = {}) {
  const onOpen = vi.fn();
  const onExport = vi.fn();
  const onMapAppearance = vi.fn();
  render(
    <WorkspaceHeader
      durationSec={3}
      ready
      opening={false}
      onOpen={onOpen}
      onExport={onExport}
      onMapAppearance={onMapAppearance}
      mapAppearanceOpen={false}
      {...overrides}
    />,
  );
  return { onOpen, onExport, onMapAppearance };
}

describe('WorkspaceHeader', () => {
  it('shows the wordmark and the project identity', () => {
    renderHeader();
    expect(document.querySelector('.brand')?.textContent).toBe('neo2 / flightpath');
    expect(screen.getByText('Flight workspace')).toBeTruthy();
    expect(screen.getByText('Recording · 0:03')).toBeTruthy();
  });

  it.for([
    { ready: true, opening: false, status: 'Video + telemetry ready' },
    { ready: false, opening: false, status: 'Warming tiles…' },
    { ready: false, opening: true, status: 'Preparing recording…' },
  ])('reports $status', ({ ready, opening, status }) => {
    renderHeader({ ready, opening });
    expect(screen.getByText(status)).toBeTruthy();
  });

  it('dispatches the header actions', () => {
    const { onOpen, onExport, onMapAppearance } = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Open…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Map appearance' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onMapAppearance).toHaveBeenCalledTimes(1);
  });

  it('holds Open while the Open flow prepares', () => {
    renderHeader({ opening: true });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' }).disabled).toBe(true);
  });

  it('marks the map appearance toggle state', () => {
    const { rerender } = render(
      <WorkspaceHeader
        durationSec={3}
        ready
        opening={false}
        onOpen={() => {}}
        onExport={() => {}}
        onMapAppearance={() => {}}
        mapAppearanceOpen={false}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Map appearance' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    rerender(
      <WorkspaceHeader
        durationSec={3}
        ready
        opening={false}
        onOpen={() => {}}
        onExport={() => {}}
        onMapAppearance={() => {}}
        mapAppearanceOpen
      />,
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
