// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useModalFocus } from '../../ui/hooks/useModalFocus.js';

afterEach(cleanup);

function Panel() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(panelRef);
  return (
    <div ref={panelRef} tabIndex={-1} data-testid="panel">
      <button>First</button>
      <button>Middle</button>
      <button>Last</button>
    </div>
  );
}

const panel = () => screen.getByTestId('panel');
const buttons = () => [...panel().querySelectorAll<HTMLButtonElement>('button')];

describe('useModalFocus', () => {
  it('takes focus on open and restores it to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(<Panel />);
    expect(document.activeElement).toBe(panel());
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Panel />);
    const [first, , last] = buttons();
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    render(<Panel />);
    const [first, , last] = buttons();
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it('lets Tab between controls inside the panel pass through', () => {
    render(<Panel />);
    const [first, middle] = buttons();
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(first);
    middle.focus();
    expect(fireEvent.keyDown(middle, { key: 'Tab', shiftKey: true })).toBe(true);
  });

  it('pulls a Tab that starts outside the panel back inside', () => {
    render(<Panel />);
    const [first, , last] = buttons();
    panel().focus();
    expect(fireEvent.keyDown(panel(), { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);
    panel().focus();
    expect(fireEvent.keyDown(panel(), { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
  });
});
