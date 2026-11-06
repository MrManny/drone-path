// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusBar } from '../../ui/components/StatusBar.js';

afterEach(cleanup);

describe('StatusBar', () => {
  it.for([
    { ready: true, want: 'Ready' },
    { ready: false, want: 'Preparing…' },
  ])('reads $want while ready is $ready', ({ ready, want }) => {
    render(
      <StatusBar ready={ready} hasTelemetry durationSec={3} onHelp={() => {}} />,
    );
    expect(screen.getByText(want)).toBeTruthy();
    expect(screen.getByText('0:03 duration')).toBeTruthy();
  });

  it.for([
    { hasTelemetry: true, shown: true },
    { hasTelemetry: false, shown: false },
  ])('telemetry line shown: $shown', ({ hasTelemetry, shown }) => {
    render(
      <StatusBar ready hasTelemetry={hasTelemetry} durationSec={3} onHelp={() => {}} />,
    );
    expect(screen.queryByText('SRT telemetry loaded') !== null).toBe(shown);
  });

  it('opens help from the bar', () => {
    const onHelp = vi.fn();
    render(<StatusBar ready hasTelemetry durationSec={3} onHelp={onHelp} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(onHelp).toHaveBeenCalledTimes(1);
  });
});
