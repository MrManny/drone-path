// Run with Electron as Node to inspect the packaged app through ASAR-aware fs.
'use strict';

const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const process = require('node:process');

const ffmpegDownloadPackage = 'ffmpeg-ffprobe-static';

function readManifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
}

function productionDependencies(manifest) {
  const dependencies = new Map();
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    dependencies.set(name, manifest.peerDependenciesMeta?.[name]?.optional === true);
  }
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    dependencies.set(name, false);
  }
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    dependencies.set(name, true);
  }
  return dependencies;
}

function resolvePackageDirectory(from, name, root) {
  // Search Node's dependency paths without requiring a package to export its
  // package.json or execute its main module.
  const fromPackage = createRequire(path.join(from, 'package.json'));
  const lookup = fromPackage.resolve.paths(`${name}/package.json`) ?? [];
  return lookup
    .filter((dir) => dir.startsWith(root + path.sep))
    .map((dir) => path.join(dir, name))
    .find((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

function identity(name, manifest) {
  const alias = name === manifest.name ? '' : ` (${manifest.name})`;
  return `${name}@${manifest.version}${alias}`;
}

function installedPackages(appDirectory, skipFfmpegDownload) {
  const packages = new Map();
  const dependenciesByDirectory = new Map();
  const workspaceRoot = fs.realpathSync(path.resolve(appDirectory, '..', '..'));
  const app = fs.realpathSync(appDirectory);
  const pending = [app];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (dependenciesByDirectory.has(directory)) continue;
    const dependencies = new Map();
    dependenciesByDirectory.set(directory, dependencies);

    for (const [name, optional] of productionDependencies(readManifest(directory))) {
      // The app uses the separately bundled tools under resources/ff.
      if (skipFfmpegDownload && name === ffmpegDownloadPackage) continue;
      const dependency = resolvePackageDirectory(directory, name, workspaceRoot);
      if (!dependency) {
        if (optional) continue;
        throw new Error(`missing installed dependency '${name}' of ${directory}`);
      }
      const dependencyDirectory = fs.realpathSync(dependency);
      const packageIdentity = identity(name, readManifest(dependencyDirectory));
      packages.set(packageIdentity, name);
      dependencies.set(name, { directory: dependencyDirectory, packageIdentity });
      pending.push(dependencyDirectory);
    }
  }
  return { packages, dependenciesByDirectory, app };
}

function ffmpegDownloadExclusions(appDirectory) {
  const runtimeNames = new Set(installedPackages(appDirectory, true).packages.values());
  const installedNames = new Set(installedPackages(appDirectory, false).packages.values());
  return [...installedNames]
    .filter((name) => !runtimeNames.has(name))
    .sort()
    .map((name) => `!**/node_modules/${name}/**`);
}

function directoriesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((entry) =>
    !entry.startsWith('.') && fs.statSync(path.join(directory, entry)).isDirectory(),
  );
}

function packagedNames(modules) {
  return directoriesIn(modules).flatMap((entry) => {
    if (!entry.startsWith('@')) return [entry];
    return directoriesIn(path.join(modules, entry)).map((name) => `${entry}/${name}`);
  });
}

function packagedPackages(archive) {
  const packages = new Set();
  const pending = [archive];
  while (pending.length > 0) {
    const modules = path.join(pending.pop(), 'node_modules');
    for (const name of packagedNames(modules)) {
      const directory = path.join(modules, name);
      packages.add(identity(name, readManifest(directory)));
      pending.push(directory);
    }
  }
  return packages;
}

function verifyPackageResolution(installed, archive) {
  const pending = [{ source: installed.app, packed: archive }];
  const visited = new Set();
  while (pending.length > 0) {
    const { source, packed } = pending.pop();
    // The same packaged directory can represent different installed copies.
    const pair = JSON.stringify([source, packed]);
    if (visited.has(pair)) continue;
    visited.add(pair);

    for (const [name, expected] of installed.dependenciesByDirectory.get(source)) {
      const directory = resolvePackageDirectory(packed, name, archive);
      const actual = directory ? identity(name, readManifest(directory)) : null;
      if (actual !== expected.packageIdentity) {
        const owner = path.relative(archive, packed) || 'the app root';
        throw new Error(
          `the desktop ASAR cannot resolve ${expected.packageIdentity} from ${owner}` +
            (actual ? ` (found ${actual})` : ''),
        );
      }
      pending.push({ source: expected.directory, packed: directory });
    }
  }
}

function verifyPackageDependencies(appDirectory, archive) {
  const installed = installedPackages(appDirectory, true);
  const expected = installed.packages;
  const packed = packagedPackages(archive);
  const missing = [...expected.keys()].filter((entry) => !packed.has(entry)).sort();
  const unexpected = [...packed].filter((entry) => !expected.has(entry)).sort();
  if (missing.length || unexpected.length) {
    throw new Error(
      'the desktop ASAR has a different dependency set than the desktop workspace' +
        (missing.length ? `\n  missing: ${missing.join(', ')}` : '') +
        (unexpected.length ? `\n  unexpected: ${unexpected.join(', ')}` : ''),
    );
  }
  verifyPackageResolution(installed, archive);
  return [...packed].sort();
}

if (require.main === module) {
  try {
    const [archive] = process.argv.slice(2);
    if (!archive) throw new Error('usage: electron build/verify-asar.cjs <path-to-app.asar>');
    const verified = verifyPackageDependencies(path.join(__dirname, '..'), path.resolve(archive));
    process.stdout.write(`verified desktop ASAR dependencies: ${verified.join(', ')}\n`);
  } catch (error) {
    process.stderr.write(`[drone-path] ERROR: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ffmpegDownloadExclusions, verifyPackageDependencies };
