import { describe, expect, it } from 'vitest';

import {
  isExternalTarget,
  pageSlugOf,
  parseImageRef,
  parsePageLink,
  sourceNameOf,
  validateCorpus,
} from '../../src/manual/links.js';
import type { CompiledRefs } from '../../src/manual/links.js';
import type { ManualPage } from '../../src/manual/model.js';

describe('pageSlugOf', () => {
  it.for<{ file: string; slug: string }>([
    { file: 'README.md', slug: 'index' },
    { file: 'keyboard-shortcuts.md', slug: 'keyboard-shortcuts' },
    { file: 'cli.md', slug: 'cli' },
  ])('maps $file to $slug', ({ file, slug }) => {
    expect(pageSlugOf(file)).toBe(slug);
  });

  it('maps the index slug back to its file name', () => {
    expect(sourceNameOf('index')).toBe('README.md');
    expect(sourceNameOf('cli')).toBe('cli.md');
  });
});

describe('isExternalTarget', () => {
  it.for<{ target: string; external: boolean }>([
    { target: 'https://example.com', external: true },
    { target: 'HTTP://example.com', external: true },
    { target: 'mailto:a@b.c', external: true },
    { target: 'other.md', external: false },
    { target: '#anchor', external: false },
    { target: '../images/x.jpg', external: false },
  ])('calls "$target" external: $external', ({ target, external }) => {
    expect(isExternalTarget(target)).toBe(external);
  });
});

describe('parsePageLink', () => {
  it.for<{ raw: string; target: { slug: string; anchor: string | null } | null }>([
    { raw: 'other.md', target: { slug: 'other', anchor: null } },
    { raw: './other.md', target: { slug: 'other', anchor: null } },
    { raw: 'README.md', target: { slug: 'index', anchor: null } },
    { raw: 'other.md#part', target: { slug: 'other', anchor: 'part' } },
    { raw: '#part', target: { slug: 'index', anchor: 'part' } },
    { raw: '#', target: null },
    { raw: '', target: null },
    { raw: 'dir/other.md', target: null },
    { raw: 'notes.txt', target: null },
    { raw: 'other.md#a#b', target: null },
    { raw: '../images/x.jpg', target: null },
  ])('parses "$raw"', ({ raw, target }) => {
    expect(parsePageLink(raw, 'index')).toEqual(target);
  });

  it('resolves page-less anchors against the current page', () => {
    expect(parsePageLink('#part', 'desktop-app')).toEqual({ slug: 'desktop-app', anchor: 'part' });
  });
});

describe('parseImageRef', () => {
  it.for<{ raw: string; file: string | null }>([
    { raw: '../images/shot.jpg', file: 'shot.jpg' },
    { raw: '../images/sub/shot.jpg', file: null },
    { raw: 'images/shot.jpg', file: null },
    { raw: 'https://example.com/x.png', file: null },
    { raw: '../images/', file: null },
  ])('parses "$raw"', ({ raw, file }) => {
    expect(parseImageRef(raw)).toBe(file);
  });
});

function corpus(): {
  slug: string;
  page: ManualPage;
  refs: CompiledRefs;
}[] {
  return [
    {
      slug: 'index',
      page: {
        slug: 'index',
        title: 'Manual',
        headings: [{ id: 'manual', text: 'Manual', level: 1 }],
        html: '',
      },
      refs: {
        links: [{ raw: 'a.md#part', label: 'A', slug: 'a', anchor: 'part' }],
        images: [{ raw: '../images/x.jpg', file: 'x.jpg' }],
        unknown: [],
      },
    },
    {
      slug: 'a',
      page: {
        slug: 'a',
        title: 'A',
        headings: [
          { id: 'a', text: 'A', level: 1 },
          { id: 'part', text: 'Part', level: 2 },
        ],
        html: '',
      },
      refs: { links: [], images: [], unknown: [] },
    },
  ];
}

describe('validateCorpus', () => {
  it('accepts a corpus whose references all resolve', () => {
    expect(validateCorpus(corpus(), new Set(['x.jpg']))).toEqual([]);
  });

  it.for<{ name: string; mutate: (pages: ReturnType<typeof corpus>) => void; images: string[]; file: string; message: string }>(
    [
      {
        name: 'link to a missing page',
        mutate: (pages) => {
          pages[1].refs.links.push({ raw: 'ghost.md', label: 'G', slug: 'ghost', anchor: null });
        },
        images: ['x.jpg'],
        file: 'docs/user/a.md',
        message: 'missing page "ghost.md"',
      },
      {
        name: 'link to a missing anchor',
        mutate: (pages) => {
          pages[1].refs.links.push({ raw: 'index.md#nope', label: 'N', slug: 'index', anchor: 'nope' });
        },
        images: ['x.jpg'],
        file: 'docs/user/a.md',
        message: 'missing anchor "#nope" in "README.md"',
      },
      {
        name: 'image file that is not in docs/images',
        mutate: () => {},
        images: [],
        file: 'docs/user/README.md',
        message: 'missing file "docs/images/x.jpg"',
      },
      {
        name: 'reference of unknown shape',
        mutate: (pages) => {
          pages[1].refs.unknown.push('../notes.txt');
        },
        images: ['x.jpg'],
        file: 'docs/user/a.md',
        message: 'neither a .md page link nor a web link',
      },
    ],
  )('rejects a $name', ({ mutate, images, file, message }) => {
    const pages = corpus();
    mutate(pages);
    const issues = validateCorpus(pages, new Set(images));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain(message);
    expect(issues[0]?.file).toBe(file);
  });
});
