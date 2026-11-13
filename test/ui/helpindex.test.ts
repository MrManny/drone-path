// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { dropManualToc } from '../../ui/lib/helpindex.js';

const NAV = ['index', 'getting-started', 'desktop-app', 'keyboard-shortcuts'];

const INDEX_HTML =
  '<h1 id="user-manual">User manual</h1>' +
  '<p>Welcome to the manual.</p>' +
  '<ol>' +
  '<li><a href="#manual/getting-started" data-manual-slug="getting-started">Getting started</a> — first render.</li>' +
  '<li><a href="#manual/desktop-app" data-manual-slug="desktop-app">Desktop app</a> — the app.</li>' +
  '<li><a href="#manual/keyboard-shortcuts" data-manual-slug="keyboard-shortcuts">Keyboard shortcuts</a> — keys.</li>' +
  '</ol>';

describe('dropManualToc', () => {
  it('removes the index page list of manual pages', () => {
    const html = dropManualToc(INDEX_HTML, NAV);
    expect(html).not.toContain('<ol>');
    expect(html).not.toContain('Getting started');
  });

  it('keeps the rest of the page', () => {
    const html = dropManualToc(INDEX_HTML, NAV);
    expect(html).toContain('<h1 id="user-manual">User manual</h1>');
    expect(html).toContain('Welcome to the manual.');
  });

  it('leaves the first matching list only', () => {
    const html = dropManualToc(`${INDEX_HTML}<ol><li><p>Second list.</p></li></ol>`, NAV);
    expect(html).toContain('Second list.');
    expect(html).not.toContain('Getting started');
  });

  it('keeps content lists whose items are not manual pages', () => {
    const html = dropManualToc('<ol><li>Run the render.</li><li>Open the folder.</li></ol>', NAV);
    expect(html).toContain('Run the render.');
  });

  it('keeps lists mixing manual links with other links', () => {
    const mixed =
      '<ol>' +
      '<li><a href="https://example.com">web</a></li>' +
      '<li><a href="#manual/desktop-app" data-manual-slug="desktop-app">Desktop app</a></li>' +
      '</ol>';
    expect(dropManualToc(mixed, NAV)).toContain('example.com');
  });

  it('keeps lists linking a page more than once', () => {
    const twice =
      '<ol>' +
      '<li><a href="#manual/desktop-app" data-manual-slug="desktop-app">Desktop app</a></li>' +
      '<li><a href="#manual/desktop-app" data-manual-slug="desktop-app">Desktop app again</a></li>' +
      '</ol>';
    expect(dropManualToc(twice, NAV)).toContain('<ol>');
  });

  it('keeps lists pointing outside the manual navigation', () => {
    const outside =
      '<ol>' +
      '<li><a href="#manual/ghost" data-manual-slug="ghost">Ghost</a></li>' +
      '<li><a href="#manual/desktop-app" data-manual-slug="desktop-app">Desktop app</a></li>' +
      '</ol>';
    expect(dropManualToc(outside, NAV)).toContain('Ghost');
  });

  it('returns a page without a list unchanged', () => {
    expect(dropManualToc('<p>Nothing to drop.</p>', NAV)).toContain('Nothing to drop.');
  });
});
