import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pageSlugOf, validateCorpus } from '../src/manual/links.js';
import { compileMarkdown } from '../src/manual/markdown.js';
import type { CompiledPage } from '../src/manual/markdown.js';
import { navFromIndex } from '../src/manual/nav.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userDir = path.join(root, 'docs', 'user');

function corpus(): CompiledPage[] {
  return fs
    .readdirSync(userDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => compileMarkdown(fs.readFileSync(path.join(userDir, file), 'utf8'), pageSlugOf(file)));
}

describe('the checked-in manual corpus', () => {
  it('has no dangling links, anchors or images', () => {
    const imageFiles = new Set(fs.readdirSync(path.join(root, 'docs', 'images')));
    const issues = validateCorpus(corpus(), imageFiles);
    expect(issues.map((i) => `${i.file}: ${i.message}`)).toEqual([]);
  });

  it('lists every page in the index navigation', () => {
    const pages = corpus();
    const nav = navFromIndex(pages.find((p) => p.slug === 'index') as CompiledPage);
    const listed = new Set(nav.map((entry) => entry.slug));
    expect(pages.map((p) => p.slug).filter((slug) => !listed.has(slug))).toEqual([]);
  });

  it('gives every page a level-1 title', () => {
    expect(corpus().filter((p) => p.page.title === '').map((p) => p.slug)).toEqual([]);
  });
});

describe('docs/user/keyboard-shortcuts.md', () => {
  const doc = fs.readFileSync(path.join(userDir, 'keyboard-shortcuts.md'), 'utf8');
  const keyCells = doc
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => line.split('|')[1] ?? '');
  const documented = new Set(
    keyCells.flatMap((cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '')),
  );

  const DISPLAY: Record<string, string> = {
    ' ': 'Space',
    Spacebar: 'Space',
    k: 'K',
    K: 'K',
    '1': '1',
    '2': '2',
    '3': '3',
    '4': '4',
    Home: 'Home',
    End: 'End',
    i: 'I',
    I: 'I',
    o: 'O',
    O: 'O',
    p: 'P',
    P: 'P',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };

  const hotkeys = fs.readFileSync(path.join(root, 'ui', 'lib', 'hotkeys.ts'), 'utf8');
  const literals = [...new Set([...hotkeys.matchAll(/case '([^']*)':/g)].map((m) => m[1] ?? ''))];

  it.for(literals)('documents the %s key', (literal) => {
    const display = DISPLAY[literal];
    expect(
      display,
      `map the "${literal}" key in DISPLAY and add it to docs/user/keyboard-shortcuts.md`,
    ).toBeDefined();
    expect(documented.has(display)).toBe(true);
  });

  // Escape and Ctrl+O are mapped outside the switch in hotkeys.ts, so the
  // literal scan cannot see them; they still belong in the table.
  it.for(['Esc', 'Ctrl+O'])('documents the %s key', (key) => {
    expect(documented.has(key)).toBe(true);
  });
});
