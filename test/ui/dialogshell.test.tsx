// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
