import path from 'node:path';

import { expect, it } from 'vitest';

import { archiveDbPath } from '../src/paths.js';

it('uses an absolute path for the archive database override', () => {
  expect(archiveDbPath('test.sqlite')).toBe(path.resolve('test.sqlite'));
});

it('uses a per-user absolute path when there is no override', () => {
  const file = archiveDbPath();
  expect(path.isAbsolute(file)).toBe(true);
  expect(file).toMatch(/drone-path[/\\]archive\.sqlite$/);
});
