// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DialogShell } from '../../ui/components/DialogShell.js';

afterEach(cleanup);

describe('DialogShell focus management', () => {
  it('moves focus to the panel and marks it modal', () => {
    render(<DialogShell title="Export" onClose={() => {}}>body</DialogShell>);
    const panel = screen.getByRole('dialog', { name: 'Export' });
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(panel);
  });

  it('returns focus to the opener when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(<DialogShell title="Export" onClose={() => {}}>body</DialogShell>);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('DialogShell panel class', () => {
  it('keeps the panel recipe alone by default', () => {
    render(<DialogShell title="Export" onClose={() => {}}>body</DialogShell>);
    expect(screen.getByRole('dialog', { name: 'Export' }).className).toBe('settings-panel');
  });

  it('adds the extra class beside the panel recipe', () => {
    render(
      <DialogShell title="Export" onClose={() => {}} panelClass="export-panel">
        body
      </DialogShell>,
    );
    expect(screen.getByRole('dialog', { name: 'Export' }).className).toBe(
      'settings-panel export-panel',
    );
  });
});

describe('DialogShell focus containment (#238)', () => {
  function controls(): HTMLButtonElement[] {
    const panel = screen.getByRole('dialog', { name: 'Export' });
    return [...panel.querySelectorAll<HTMLButtonElement>('button')];
  }

  it('wraps Tab from the last control back to the first', () => {
    render(
      <DialogShell title="Export" onClose={() => {}}>
        <button>One</button>
        <button>Two</button>
      </DialogShell>,
    );
    const all = controls();
    const last = all[all.length - 1];
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(all[0]);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    render(
      <DialogShell title="Export" onClose={() => {}}>
        <button>One</button>
        <button>Two</button>
      </DialogShell>,
    );
    const all = controls();
    all[0].focus();
    expect(fireEvent.keyDown(all[0], { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(all[all.length - 1]);
  });
});
