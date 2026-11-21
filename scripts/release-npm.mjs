// Verify the published workspaces and desktop agree with the release tag.
// node scripts/release-npm.mjs verify v<version>
// node scripts/release-npm.mjs dry-run v<version>
// Dry run packs in dependency order without sending anything to npm.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ERROR_PREFIX, errorMessage } from '../packages/core/src/errors.ts';
import { execOrThrow, npm } from './lib/exec.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const publishedWorkspaces = [
  { name: 'drone-path-core', directory: 'packages/core' },
  { name: 'drone-path-engine', directory: 'packages/engine' },
  { name: 'drone-path', directory: 'packages/cli' },
];
const desktopWorkspace = { name: 'drone-path-desktop', directory: 'apps/desktop' };

export function releasePlan(tag, root = repositoryRoot) {
  if (!tag) throw new Error('release tag is required');
  const version = tag.replace(/^v/, '');
  const mismatches = [];
  for (const { name, directory } of [...publishedWorkspaces, desktopWorkspace]) {
    const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== version) {
      mismatches.push(`${directory} has ${manifest.name}@${manifest.version}, expected ${name}@${version}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`release tag '${tag}' does not match the release manifests:\n${mismatches.join('\n')}`);
  }
  return { version, workspaces: publishedWorkspaces.map(({ name }) => name) };
}

function main([command, tag]) {
  if (command !== 'verify' && command !== 'dry-run') {
    throw new Error('usage: node scripts/release-npm.mjs <verify|dry-run> <tag>');
  }
  const { version, workspaces } = releasePlan(tag);
  console.error(`release tag matches CLI, engine, core, and desktop version ${version}`);
  if (command === 'dry-run') {
    for (const workspace of workspaces) {
      console.error(`packing ${workspace}@${version} (dry run)`);
      execOrThrow(npm, ['pack', '--dry-run', '--workspace', workspace], {
        cwd: repositoryRoot,
        stdio: 'inherit',
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (cause) {
    console.error(`${ERROR_PREFIX}${errorMessage(cause)}`);
    process.exitCode = 1;
  }
}
