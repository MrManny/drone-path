import { describe, expect, it } from 'vitest';

import { createSlugger, githubSlug } from '../../src/manual/anchors.js';

describe('githubSlug', () => {
  it.for<{ text: string; slug: string }>([
    { text: 'Getting started', slug: 'getting-started' },
    { text: 'Längsee Töplach', slug: 'längsee-töplach' },
    { text: "It's here!", slug: 'its-here' },
    { text: 'foo_bar stays', slug: 'foo_bar-stays' },
    { text: 'a  b', slug: 'a--b' },
    { text: '1280×720 output', slug: '1280720-output' },
    { text: 'CLI and config reference', slug: 'cli-and-config-reference' },
  ])('turns "$text" into $slug', ({ text, slug }) => {
    expect(githubSlug(text)).toBe(slug);
  });
});

describe('createSlugger', () => {
  it('keeps the first heading plain and numbers duplicates like GitHub', () => {
    const slug = createSlugger();
    expect(slug('Foo')).toBe('foo');
    expect(slug('Bar')).toBe('bar');
    expect(slug('Foo')).toBe('foo-1');
    expect(slug('foo')).toBe('foo-2');
  });

  it('counts duplicates per base slug, not per spelling', () => {
    const slug = createSlugger();
    expect(slug('A B')).toBe('a-b');
    expect(slug('A-B')).toBe('a-b-1');
    expect(slug('A!B')).toBe('ab');
  });
});
