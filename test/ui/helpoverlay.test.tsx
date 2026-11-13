// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HelpOverlay } from '../../ui/components/HelpOverlay.js';
import type { ManualBundle } from '../../src/manual/model.js';

afterEach(cleanup);

const BUNDLE: ManualBundle = {
  nav: [
    { slug: 'index', label: 'User manual' },
    { slug: 'shortcuts', label: 'Keyboard shortcuts' },
  ],
  pages: {
    index: {
      slug: 'index',
      title: 'User manual',
      headings: [{ id: 'user-manual', text: 'User manual', level: 1 }],
      html:
        '<h1 id="user-manual">User manual</h1><p>See ' +
        '<a href="#manual/shortcuts" data-manual-slug="shortcuts">Keyboard shortcuts</a>.</p>',
    },
    shortcuts: {
      slug: 'shortcuts',
      title: 'Keyboard shortcuts',
      headings: [
        { id: 'keyboard-shortcuts', text: 'Keyboard shortcuts', level: 1 },
        { id: 'playback', text: 'Playback', level: 2 },
      ],
      html:
        '<h1 id="keyboard-shortcuts">Keyboard shortcuts</h1>' +
        '<h2 id="playback">Playback</h2><p>Space plays.</p>' +
        '<p><a href="#manual/shortcuts" data-manual-slug="shortcuts" data-manual-anchor="playback">jump</a></p>' +
        '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">web</a></p>',
    },
  },
};

const nav = () => screen.getByRole('navigation', { name: 'Manual pages' });

function renderHelp(onClose = vi.fn()) {
  render(<HelpOverlay bundle={BUNDLE} onClose={onClose} />);
  return onClose;
}

describe('HelpOverlay', () => {
  it('opens on the manual home with the navigation', () => {
    renderHelp();
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeTruthy();
    expect(nav()).toBeTruthy();
    expect(within(nav()).getByRole('link', { name: 'User manual' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByText('See', { exact: false })).toBeTruthy();
  });

  it('lists the manual pages once, dropping the home page in-page index', () => {
    const bundle: ManualBundle = {
      nav: [
        { slug: 'index', label: 'User manual' },
        { slug: 'shortcuts', label: 'Keyboard shortcuts' },
        { slug: 'cli', label: 'CLI usage' },
      ],
      pages: {
        index: {
          slug: 'index',
          title: 'User manual',
          headings: [{ id: 'user-manual', text: 'User manual', level: 1 }],
          html:
            '<h1 id="user-manual">User manual</h1>' +
            '<ol>' +
            '<li><a href="#manual/shortcuts" data-manual-slug="shortcuts">Keyboard shortcuts</a> — keys.</li>' +
            '<li><a href="#manual/cli" data-manual-slug="cli">CLI usage</a> — commands.</li>' +
            '</ol>',
        },
        shortcuts: BUNDLE.pages.shortcuts,
        cli: {
          slug: 'cli',
          title: 'CLI usage',
          headings: [{ id: 'cli-usage', text: 'CLI usage', level: 1 }],
          html: '<h1 id="cli-usage">CLI usage</h1><p>Commands.</p>',
        },
      },
    };
    render(<HelpOverlay bundle={bundle} onClose={vi.fn()} />);
    expect(document.querySelector('.help-content ol')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Keyboard shortcuts' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'CLI usage' })).toHaveLength(1);
  });

  it('moves to another page from the navigation', async () => {
    renderHelp();
    await userEvent.click(within(nav()).getByRole('link', { name: 'Keyboard shortcuts' }));
    expect(screen.getByText('Space plays.')).toBeTruthy();
    expect(
      within(nav()).getByRole('link', { name: 'Keyboard shortcuts' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(within(nav()).getByRole('link', { name: 'User manual' }).getAttribute('aria-current')).toBeNull();
  });

  it('follows internal content links in place', async () => {
    renderHelp();
    await userEvent.click(within(nav()).getByRole('link', { name: 'Keyboard shortcuts' }));
    await userEvent.click(screen.getByRole('link', { name: 'jump' }));
    expect(screen.getByText('Space plays.')).toBeTruthy();
  });

  it('scrolls to an anchor target after navigating', async () => {
    Element.prototype.scrollIntoView = () => {};
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderHelp();
    await userEvent.click(within(nav()).getByRole('link', { name: 'Keyboard shortcuts' }));
    await userEvent.click(screen.getByRole('link', { name: 'jump' }));
    expect(scroll.mock.instances).toContain(screen.getByText('Playback'));
    scroll.mockRestore();
  });

  it('leaves web links to the shell', async () => {
    renderHelp();
    await userEvent.click(within(nav()).getByRole('link', { name: 'Keyboard shortcuts' }));
    const web = screen.getByRole('link', { name: 'web' });
    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.getAttribute('rel')).toBe('noopener noreferrer');
    expect(web.hasAttribute('data-manual-slug')).toBe(false);
  });

  it('closes through the header close', async () => {
    const onClose = renderHelp();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes through the backdrop', () => {
    const onClose = renderHelp();
    fireEvent.click(screen.getByRole('dialog', { name: 'Help' }).parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps clicks inside the panel from closing it', () => {
    const onClose = renderHelp();
    fireEvent.click(screen.getByRole('dialog', { name: 'Help' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
