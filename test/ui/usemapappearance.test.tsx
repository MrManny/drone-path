// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useMapAppearance } from '../../ui/hooks/useMapAppearance.js';

function Harness() {
  const { open, triggerRef, toggle, close } = useMapAppearance();
  return (
    <>
      {/* The real trigger is the menu bar container, so the harness one is a
          focusable element of a different tag than a button. */}
      <div
        ref={(node) => {
          triggerRef.current = node;
        }}
        tabIndex={-1}
        data-testid="trigger"
      >
        <button onClick={toggle}>Map appearance</button>
      </div>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
      <button onClick={close}>Close</button>
    </>
  );
}

afterEach(cleanup);

function mount() {
  render(<Harness />);
  return {
    toggle: () => fireEvent.click(screen.getByRole('button', { name: 'Map appearance' })),
    close: () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
    state: () => screen.getByTestId('state').textContent,
    trigger: () => screen.getByTestId('trigger'),
  };
}

describe('useMapAppearance', () => {
  it('toggles open and closed', () => {
    const harness = mount();
    expect(harness.state()).toBe('closed');
    harness.toggle();
    expect(harness.state()).toBe('open');
    harness.toggle();
    expect(harness.state()).toBe('closed');
  });

  it('returns focus to the trigger when it closes', () => {
    const harness = mount();
    harness.toggle();
    harness.close();
    expect(document.activeElement).toBe(harness.trigger());
    harness.toggle();
    harness.toggle();
    expect(document.activeElement).toBe(harness.trigger());
  });
});
