import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CLEAN_PATHS, runBuild } from '../scripts/build.mjs';
import { cleanupTmpDirs, tmpDir } from './fixtures/core.js';

const execOrThrow = vi.hoisted(() => vi.fn<(command: string, args: string[], options?: object) => string>());
vi.mock('../scripts/lib/exec.mjs', () => ({ execOrThrow, npm: 'npm' }));

beforeEach(() => {
  execOrThrow.mockReset();
});
afterEach(() => {
  cleanupTmpDirs();
  vi.restoreAllMocks();
});

it('prep runs codegen, tsc -b, preload, app typecheck, manual, and buildinfo without UI export', () => {
  const root = path.resolve('/repo');
  runBuild('prep', root);

  const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  expect(execOrThrow.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
    [process.execPath, [path.join(root, 'apps/desktop/scripts/build-desktop-catalogs.mjs')]],
    [process.execPath, [tscBin, '-b', 'tsconfig.build.json']],
    [process.execPath, [path.join(root, 'apps/desktop/scripts/build-preload.mjs')]],
    [process.execPath, [tscBin, '--noEmit', '-p', 'apps/desktop/app/tsconfig.json']],
    [process.execPath, [path.join(root, 'packages/tooling/dist/manual/build.js')]],
    [process.execPath, [path.join(root, 'packages/tooling/dist/buildinfo.js')]],
  ]);
});

it('build runs prep followed by the desktop UI export', () => {
  const root = path.resolve('/repo');
  runBuild('build', root);

  expect(execOrThrow).toHaveBeenCalledTimes(7);
  expect(execOrThrow.mock.calls[6]?.slice(0, 2)).toEqual([
    'npm',
    ['run', 'build:ui', '--workspace', 'drone-path-desktop'],
  ]);
});

it('clean removes build outputs while preserving tracked app files', () => {
  const root = tmpDir();
  for (const relativePath of CLEAN_PATHS) {
    const target = path.join(root, relativePath);
    if (relativePath.endsWith('.tsbuildinfo') || relativePath.endsWith('.ts')) {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'artifact');
    } else {
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'file.js'), 'artifact');
    }
  }
  const trackedPreload = path.join(root, 'apps/desktop/app/preload.cjs');
  mkdirSync(path.dirname(trackedPreload), { recursive: true });
  writeFileSync(trackedPreload, 'tracked');

  runBuild('clean', root);

  for (const relativePath of CLEAN_PATHS) {
    expect(existsSync(path.join(root, relativePath))).toBe(false);
  }
  expect(existsSync(trackedPreload)).toBe(true);
  expect(execOrThrow).not.toHaveBeenCalled();
});

it('rejects unknown build modes', () => {
  expect(() => runBuild('unknown', tmpDir())).toThrow(
    'usage: node scripts/build.mjs [build|prep|clean]',
  );
  expect(execOrThrow).not.toHaveBeenCalled();
});
