// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransportBar } from '../../ui/components/TransportBar.js';

afterEach(cleanup);

function renderBar(overrides: Partial<Parameters<typeof TransportBar>[0]> = {}) {
  const dispatch = vi.fn();
  const timeRef = createRef<HTMLSpanElement>();
  render(
    <TransportBar
      dispatch={dispatch}
      ready
      playing={false}
      speed={1}
      fps={30}
      durationSec={3}
      timeRef={timeRef}
      {...overrides}
    />,
  );
  return { dispatch, timeRef };
}

describe('TransportBar', () => {
  it('dispatches the skip actions from the transport buttons', () => {
    const { dispatch } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to start' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'seekStart' });
    fireEvent.click(screen.getByRole('button', { name: 'Jump to end' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'seekEnd' });
    expect(screen.getByRole('button', { name: 'Jump to start' }).getAttribute('title')).toBe(
      'Jump to start (Home)',
    );
    expect(screen.getByRole('button', { name: 'Jump to end' }).getAttribute('title')).toBe(
      'Jump to end (End)',
    );
  });

  it('toggles playback from the play button', () => {
    const { dispatch } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'togglePlay' });
  });

  it.for([
    { ready: true, playing: false, label: 'Play', disabled: false },
    { ready: true, playing: true, label: 'Pause', disabled: false },
    { ready: false, playing: false, label: 'Warming tiles…', disabled: true },
  ])('shows $label while ready is $ready', ({ ready, playing, label, disabled }) => {
    renderBar({ ready, playing });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: label });
    expect(button.disabled).toBe(disabled);
  });

  it('shows the position readout from raw values', () => {
    const { timeRef } = renderBar();
    expect(timeRef.current?.textContent).toBe('0:00 / 0:03');
  });

  it('collects the speed segments in one labeled group', () => {
    const { dispatch } = renderBar({ speed: 2 });
    const group = screen.getByRole('group', { name: 'Playback speed' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '1×',
      '2×',
      '3×',
      '4×',
    ]);
    const pressed = within(group)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true', 'false', 'false']);
    fireEvent.click(screen.getByRole('button', { name: '3×' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'speed', rate: 3 });
    expect(
      screen.getByRole('button', { name: '3×' }).getAttribute('title'),
    ).toBe('Playback speed 3× (3)');
  });
});
