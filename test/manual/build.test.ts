import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildManual, defaultManualPaths } from '../../src/manual/build.js';
import type { ManualBuildPaths } from '../../src/manual/build.js';
import { cleanupTmpDirs, tmpDir } from '../fixtures.js';

afterEach(cleanupTmpDirs);

function corpus(overrides: Partial<Record<string, string | null>> = {}): ManualBuildPaths {
  const dir = tmpDir();
  const paths = defaultManualPaths(dir);
  fs.mkdirSync(paths.userDir, { recursive: true });
  fs.mkdirSync(paths.imagesDir, { recursive: true });
  const files: Record<string, string | null> = {
    'README.md': '# Manual\n\n[Start](start.md)\n',
    'start.md': '# Start\n\n![shot](../images/shot.jpg)\n\n[home](README.md#manual)\n',
    ...overrides,
  };
  for (const [name, content] of Object.entries(files)) {
    if (content !== null) fs.writeFileSync(path.join(paths.userDir, name), content);
  }
  fs.writeFileSync(path.join(paths.imagesDir, 'shot.jpg'), 'jpeg-bytes');
  return paths;
}

describe('buildManual', () => {
  it('emits the typed module and copies the referenced images', () => {
    const paths = corpus();
    const result = buildManual(paths);
    expect(result).toEqual({ pages: 2, images: ['shot.jpg'] });
    const moduleText = fs.readFileSync(paths.moduleFile, 'utf8');
    expect(moduleText).toContain('"title": "Start"');
    expect(moduleText).toContain('"label": "Start"');
    expect(fs.readFileSync(path.join(paths.assetDir, 'shot.jpg'), 'utf8')).toBe('jpeg-bytes');
  });

  it('is idempotent', () => {
    const paths = corpus();
    buildManual(paths);
    const first = fs.readFileSync(paths.moduleFile, 'utf8');
    buildManual(paths);
    expect(fs.readFileSync(paths.moduleFile, 'utf8')).toBe(first);
  });

  it('sorts pages by slug regardless of file system order', () => {
    const paths = corpus({ 'zz.md': '# Z\n', 'aa.md': '# A\n' });
    buildManual(paths);
    const text = fs.readFileSync(paths.moduleFile, 'utf8');
    const bundle = JSON.parse(text.slice(text.indexOf('= ') + 2, text.lastIndexOf(';\n'))) as {
      pages: Record<string, unknown>;
    };
    expect(Object.keys(bundle.pages)).toEqual(['aa', 'index', 'start', 'zz']);
  });

  it.for<{ name: string; overrides: Partial<Record<string, string | null>>; message: string }>([
    {
      name: 'link to a missing page',
      overrides: { 'start.md': '# Start\n\n[to](ghost.md)\n' },
      message: 'docs/user/start.md: link "ghost.md" points at missing page "ghost.md"',
    },
    {
      name: 'image that is not in docs/images',
      overrides: { 'start.md': '# Start\n\n![x](../images/ghost.jpg)\n' },
      message: 'docs/user/start.md: image "../images/ghost.jpg" points at missing file',
    },
    {
      name: 'a page without a level-1 heading',
      overrides: { 'start.md': '## Only a second-level heading\n' },
      message: 'docs/user/start.md needs a level-1',
    },
    {
      name: 'a missing index page',
      overrides: { 'README.md': null },
      message: 'docs/user/README.md is missing',
    },
    {
      name: 'a reference of unknown shape',
      overrides: { 'start.md': '# Start\n\n[to](../notes.txt)\n' },
      message: 'is neither a .md page link nor a web link',
    },
  ])('rejects the corpus with $name', ({ overrides, message }) => {
    const paths = corpus(overrides);
    expect(() => buildManual(paths)).toThrow(message);
    expect(fs.existsSync(paths.moduleFile)).toBe(false);
  });
});
