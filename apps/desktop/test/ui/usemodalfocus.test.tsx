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

  it('traps Tab and Shift+Tab when focus falls back to document.body', () => {
    const view = render(<Panel />);
    const [first, , last] = buttons();
    document.body.focus();
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);

    document.body.focus();
    expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);

    view.unmount();
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(true);
  });

  it('keeps Tab on the panel when a focused control disables and leaves no focusable items', () => {
    function EmptyPanel() {
      const panelRef = useRef<HTMLDivElement | null>(null);
      useModalFocus(panelRef);
      return (
        <div ref={panelRef} tabIndex={-1} data-testid="panel">
          <button disabled>Restarting</button>
        </div>
      );
    }

    render(<EmptyPanel />);
    document.body.focus();
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(panel());
  });

  it('includes summary disclosures in the Tab cycle', () => {
    function DetailsPanel() {
      const panelRef = useRef<HTMLDivElement | null>(null);
      useModalFocus(panelRef);
      return (
        <div ref={panelRef} tabIndex={-1} data-testid="panel">
          <button>First</button>
          <details>
            <summary>Technical details</summary>
            <pre>trace</pre>
          </details>
        </div>
      );
    }

    render(<DetailsPanel />);
    const first = screen.getByRole('button', { name: 'First' });
    const summary = screen.getByText('Technical details');
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true);
    summary.focus();
    expect(fireEvent.keyDown(summary, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('includes regular links while excluding tabindex="-1" attribution links and controls (#396)', () => {
    function MapModalPanel() {
      const panelRef = useRef<HTMLDivElement | null>(null);
      useModalFocus(panelRef);
      return (
        <div ref={panelRef} tabIndex={-1} data-testid="panel">
          <div id="attr">
            <a href="https://example.com" tabIndex={-1}>
              Map credit
            </a>
          </div>
          <a href="https://example.com/docs">Docs</a>
          <button tabIndex={-1}>Hidden focus</button>
          <button>Done</button>
        </div>
      );
    }

    render(<MapModalPanel />);
    const docs = screen.getByRole('link', { name: 'Docs' });
    const done = screen.getByRole('button', { name: 'Done' });
    done.focus();
    expect(fireEvent.keyDown(done, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(docs);
    expect(fireEvent.keyDown(docs, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(done);
  });

  it('falls back to the panel when only disabled controls and tabindex="-1" links exist (#396)', () => {
    function CancelingExportPanel() {
      const panelRef = useRef<HTMLDivElement | null>(null);
      useModalFocus(panelRef);
      return (
        <div ref={panelRef} tabIndex={-1} data-testid="panel">
          <div id="attr">
            <a href="https://example.com" tabIndex={-1}>
              Map credit
            </a>
          </div>
          <button disabled>Close</button>
          <button disabled>Cancel export</button>
        </div>
      );
    }

    render(<CancelingExportPanel />);
    document.body.focus();
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(panel());
    document.body.focus();
    expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(panel());
  });
});
