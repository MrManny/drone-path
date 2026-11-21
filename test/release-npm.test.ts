import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { releasePlan } from '../scripts/release-npm.mjs';
import { cleanupTmpDirs, tmpDir } from './fixtures/core.js';

const manifests = {
  'packages/core': 'drone-path-core',
  'packages/archive': 'drone-path-archive',
  'packages/engine': 'drone-path-engine',
  'packages/cli': 'drone-path',
  'apps/desktop': 'drone-path-desktop',
};

function checkout(mismatchedDirectory?: string): string {
  const root = tmpDir();
  for (const [directory, name] of Object.entries(manifests)) {
    const version = directory === mismatchedDirectory ? '0.12.0' : '0.13.0';
    const location = path.join(root, directory);
    mkdirSync(location, { recursive: true });
    writeFileSync(path.join(location, 'package.json'), JSON.stringify({ name, version }));
  }
  return root;
}

afterEach(cleanupTmpDirs);

it.for(['v0.13.0', '0.13.0'])('plans release %s in dependency order', (tag) => {
  expect(releasePlan(tag, checkout())).toEqual({
    version: '0.13.0',
    workspaces: ['drone-path-core', 'drone-path-archive', 'drone-path-engine', 'drone-path'],
  });
});

it.for(Object.entries(manifests))('rejects a mismatched version in %s', ([directory, name]) => {
  expect(() => releasePlan('v0.13.0', checkout(directory))).toThrow(
    `${directory} has ${name}@0.12.0, expected ${name}@0.13.0`,
  );
});

it('requires a release tag', () => {
  expect(() => releasePlan('', checkout())).toThrow('release tag is required');
});
