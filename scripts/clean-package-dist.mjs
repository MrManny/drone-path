// Run from a publishable workspace before building so removed modules stay out
// of the next tarball.
import { rmSync } from 'node:fs';
import { relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packages = new URL('../packages/', import.meta.url);
const workspace = relative(fileURLToPath(packages), process.cwd());
if (!['core', 'archive', 'engine', 'cli'].includes(workspace)) {
  throw new Error('run this script from a publishable workspace');
}
rmSync(new URL(`${workspace}/dist/`, packages), { recursive: true, force: true });
