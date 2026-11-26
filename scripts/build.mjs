// Build pipeline orchestrator for the workspace.
// node scripts/build.mjs         — prep + Next.js static UI export
// node scripts/build.mjs prep    — TypeScript projects + desktop codegen (no Next.js UI)
// node scripts/build.mjs clean   — remove build outputs and generated artifacts
import { rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { ERROR_PREFIX, errorMessage } from '../packages/core/src/errors.ts';
import { execOrThrow, npm } from './lib/exec.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

export const CLEAN_PATHS = [
  'packages/core/dist',
  'packages/archive/dist',
  'packages/engine/dist',
  'packages/cli/dist',
  'packages/tooling/dist',
  'packages/core/tsconfig.tsbuildinfo',
  'packages/archive/tsconfig.tsbuildinfo',
  'packages/engine/tsconfig.tsbuildinfo',
  'packages/cli/tsconfig.tsbuildinfo',
  'packages/tooling/tsconfig.tsbuildinfo',
  'apps/desktop/tsconfig.tsbuildinfo',
  'apps/desktop/dist',
  'apps/desktop/dist-electron',
  'apps/desktop/app/tsconfig.tsbuildinfo',
  'apps/desktop/ui/.next',
  'apps/desktop/ui/out',
  'apps/desktop/ui/next-env.d.ts',
  'apps/desktop/ui/public',
  'apps/desktop/ui/lib/buildinfo/generated',
  'apps/desktop/ui/lib/manual/generated',
  'apps/desktop/shared/desktop-i18n/generated',
  'tsconfig.tests.tsbuildinfo',
];

function runNode(root, scriptRelativePath, args = []) {
  execOrThrow(process.execPath, [path.join(root, scriptRelativePath), ...args], {
    cwd: root,
    stdio: 'inherit',
  });
}

function runTsc(root, args) {
  execOrThrow(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), ...args], {
    cwd: root,
    stdio: 'inherit',
  });
}

function runPrep(root) {
  runNode(root, 'apps/desktop/scripts/build-desktop-catalogs.mjs');
  runTsc(root, ['-b', 'tsconfig.build.json']);
  runNode(root, 'apps/desktop/scripts/build-preload.mjs');
  runTsc(root, ['--noEmit', '-p', 'apps/desktop/app/tsconfig.json']);
  runNode(root, 'packages/tooling/dist/manual/build.js');
  runNode(root, 'packages/tooling/dist/buildinfo.js');
}

function runClean(root) {
  for (const relativePath of CLEAN_PATHS) {
    rmSync(path.join(root, relativePath), { recursive: true, force: true });
  }
}

export function runBuild(mode = 'build', root = ROOT) {
  if (mode === 'clean') {
    runClean(root);
    return;
  }
  if (mode !== 'build' && mode !== 'prep') {
    throw new Error('usage: node scripts/build.mjs [build|prep|clean]');
  }
  runPrep(root);
  if (mode === 'build') {
    execOrThrow(npm, ['run', 'build:ui', '--workspace', 'drone-path-desktop'], {
      cwd: root,
      stdio: 'inherit',
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runBuild(process.argv[2]);
  } catch (cause) {
    console.error(`${ERROR_PREFIX}${errorMessage(cause)}`);
    process.exitCode = 1;
  }
}
