import { describe, expect, it } from 'vitest';

import { compileMarkdown } from '../../src/manual/markdown.js';

describe('compileMarkdown page model', () => {
  it('titles the page from its first level-1 heading', () => {
    const { page } = compileMarkdown('# The Title\n\nbody\n\n# Second\n', 'index');
    expect(page.title).toBe('The Title');
    expect(page.headings.map((h) => h.level)).toEqual([1, 1]);
  });

  it('numbers duplicate headings the GitHub way and keeps the ids unique', () => {
    const { page } = compileMarkdown('# Foo\n\n## Foo\n\n## Foo\n', 'x');
    expect(page.headings.map((h) => h.id)).toEqual(['foo', 'foo-1', 'foo-2']);
  });

  it('renders tables, lists and fenced code', () => {
    const { page } = compileMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- item\n\n```sh\nrun\n```\n', 'x');
    expect(page.html).toContain('<table>');
    expect(page.html).toContain('<li>item</li>');
    expect(page.html).toContain('<code class="language-sh">');
  });
});

describe('compileMarkdown links', () => {
  it.for<{ name: string; md: string; expect: string }>([
    {
      name: 'page link',
      md: '[label](other.md)',
      expect: 'href="#manual/other" data-manual-slug="other"',
    },
    {
      name: 'page anchor link',
      md: '[label](other.md#part)',
      expect: 'data-manual-anchor="part" data-manual-slug="other"',
    },
    {
      name: 'same-page anchor link',
      md: '[label](#part)',
      expect: 'data-manual-anchor="part" data-manual-slug="index"',
    },
    {
      name: 'web link',
      md: '[label](https://example.com/x)',
      expect: 'href="https://example.com/x" target="_blank" rel="noopener noreferrer"',
    },
    {
      name: 'mail link',
      md: '[label](mailto:a@b.c)',
      expect: 'href="mailto:a@b.c" target="_blank" rel="noopener noreferrer"',
    },
  ])('rewrites a $name', ({ md, expect: fragment }) => {
    const { page } = compileMarkdown(md, 'index');
    expect(page.html).toContain(fragment);
  });

  it('records internal links with their label and raw target', () => {
    const { refs } = compileMarkdown('[**Bold** label](other.md#part)\n', 'index');
    expect(refs.links).toEqual([{ raw: 'other.md#part', label: 'Bold label', slug: 'other', anchor: 'part' }]);
  });

  it('keeps unknown targets clickable and records them for validation', () => {
    const { page, refs } = compileMarkdown('[label](../notes.txt)\n', 'index');
    expect(page.html).toContain('href="../notes.txt"');
    expect(refs.unknown).toEqual(['../notes.txt']);
    expect(refs.links).toEqual([]);
  });
});

describe('compileMarkdown images', () => {
  it('points bundled images at the copied asset path', () => {
    const { page, refs } = compileMarkdown('![alt text](../images/shot.jpg)\n', 'index');
    expect(page.html).toContain('<img src="/manual/images/shot.jpg" alt="alt text">');
    expect(refs.images).toEqual([{ raw: '../images/shot.jpg', file: 'shot.jpg' }]);
  });

  it('keeps unknown image targets and records them for validation', () => {
    const { page, refs } = compileMarkdown('![a](https://example.com/x.png)\n', 'index');
    expect(page.html).toContain('src="https://example.com/x.png"');
    expect(refs.unknown).toEqual(['https://example.com/x.png']);
    expect(refs.images).toEqual([]);
  });
});

describe('compileMarkdown sanitizing', () => {
  it('escapes raw HTML so the manual stays plain GFM', () => {
    const { page } = compileMarkdown('<div onclick="x">markup</div>\n', 'index');
    expect(page.html).toContain('&lt;div');
    expect(page.html).not.toContain('<div');
  });

  it('drops HTML comments like GitHub renders them', () => {
    const { page } = compileMarkdown('<!-- generated banner -->\n\n# Title\n', 'index');
    expect(page.html).not.toContain('generated banner');
    expect(page.html).toContain('<h1');
  });

  it('escapes angle brackets in text', () => {
    const { page } = compileMarkdown('a < b & c\n', 'index');
    expect(page.html).toContain('a &lt; b &amp; c');
  });
});
