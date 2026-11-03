import { describe, expect, it } from 'vitest';

import { compileMarkdown } from '../../src/manual/markdown.js';
import { navFromIndex } from '../../src/manual/nav.js';

describe('navFromIndex', () => {
  it('lists the index first and its links in document order', () => {
    const index = compileMarkdown('# Manual\n\n[Start](start.md) then [Config](config.md#files)\n', 'index');
    expect(navFromIndex(index)).toEqual([
      { slug: 'index', label: 'Manual' },
      { slug: 'start', label: 'Start' },
      { slug: 'config', label: 'Config' },
    ]);
  });

  it('keeps only the first mention of a page', () => {
    const index = compileMarkdown('# Manual\n\n- [A](a.md)\n- [B](b.md)\n- [A again](a.md)\n', 'index');
    expect(navFromIndex(index).map((entry) => entry.slug)).toEqual(['index', 'a', 'b']);
  });

  it('ignores a self-link on the index', () => {
    const index = compileMarkdown('# Manual\n\n[Home](README.md) and [A](a.md)\n', 'index');
    expect(navFromIndex(index).map((entry) => entry.slug)).toEqual(['index', 'a']);
  });

  it('is empty beyond the index when the index links nowhere', () => {
    const index = compileMarkdown('# Manual\n\nno links here\n', 'index');
    expect(navFromIndex(index)).toEqual([{ slug: 'index', label: 'Manual' }]);
  });
});
