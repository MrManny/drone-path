// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusBar } from '../../ui/components/StatusBar.js';

afterEach(cleanup);

function renderBar(overrides: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const onMapSettings = vi.fn();
  const onSwap = vi.fn();
  const onHelp = vi.fn();
  render(
    <StatusBar
      ready
      hasTelemetry
      durationSec={3}
      onMapSettings={onMapSettings}
      mapSettingsOpen={false}
      onSwap={onSwap}
      onHelp={onHelp}
      {...overrides}
    />,
  );
  return { onMapSettings, onSwap, onHelp };
}

describe('StatusBar', () => {
  it.for([
    { ready: true, want: 'Ready' },
    { ready: false, want: 'Preparing…' },
  ])('reads $want while ready is $ready', ({ ready, want }) => {
    renderBar({ ready });
    expect(screen.getByText(want)).toBeTruthy();
    expect(screen.getByText('0:03 duration')).toBeTruthy();
  });

  it.for([
    { hasTelemetry: true, shown: true },
    { hasTelemetry: false, shown: false },
  ])('telemetry line shown: $shown', ({ hasTelemetry, shown }) => {
    renderBar({ hasTelemetry });
    expect(screen.queryByText('SRT telemetry loaded') !== null).toBe(shown);
  });

  it.for([
    { name: 'Map settings', title: 'Map settings' },
    { name: 'Swap', title: 'Swap (S)' },
    { name: 'Help', title: 'Help' },
  ])('renders the icon-only $name button with its tooltip', ({ name, title }) => {
    renderBar();
    const button = screen.getByRole('button', { name });
    expect(button.getAttribute('title')).toBe(title);
    expect(button.textContent).toBe('');
  });

  it('dispatches the footer actions', () => {
    const { onMapSettings, onSwap, onHelp } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(onMapSettings).toHaveBeenCalledTimes(1);
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  it.for([
    { mapSettingsOpen: true, expanded: 'true' },
    { mapSettingsOpen: false, expanded: 'false' },
  ])(
    'aria-expanded is $expanded while the popover is open: $mapSettingsOpen',
    ({ mapSettingsOpen, expanded }) => {
      renderBar({ mapSettingsOpen });
      expect(
        screen.getByRole('button', { name: 'Map settings' }).getAttribute('aria-expanded'),
      ).toBe(expanded);
    },
  );
});
