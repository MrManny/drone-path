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

function installedDirectory(from, name, workspaceRoot) {
  // Search Node's dependency paths without requiring a package to export its
  // package.json or execute its main module.
  const fromPackage = createRequire(path.join(from, 'package.json'));
  const lookup = fromPackage.resolve.paths(`${name}/package.json`) ?? [];
  return lookup
    .filter((dir) => dir.startsWith(workspaceRoot + path.sep))
    .map((dir) => path.join(dir, name))
    .find((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

function identity(name, manifest) {
  const alias = name === manifest.name ? '' : ` (${manifest.name})`;
  return `${name}@${manifest.version}${alias}`;
}

function installedPackages(appDirectory, skipFfmpegDownload) {
  const packages = new Map();
  const visited = new Set();
  const workspaceRoot = path.resolve(appDirectory, '..', '..');
  const pending = [appDirectory];
  while (pending.length > 0) {
    const directory = fs.realpathSync(pending.pop());
    if (visited.has(directory)) continue;
    visited.add(directory);

    for (const [name, optional] of productionDependencies(readManifest(directory))) {
      // The app uses the separately bundled tools under resources/ff.
      if (skipFfmpegDownload && name === ffmpegDownloadPackage) continue;
      const dependency = installedDirectory(directory, name, workspaceRoot);
      if (!dependency) {
        if (optional) continue;
        throw new Error(`missing installed dependency '${name}' of ${directory}`);
      }
      packages.set(identity(name, readManifest(dependency)), name);
      pending.push(dependency);
    }
  }
  return packages;
}

function ffmpegDownloadExclusions(appDirectory) {
  const runtimeNames = new Set(installedPackages(appDirectory, true).values());
  const installedNames = new Set(installedPackages(appDirectory, false).values());
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

function verifyPackageDependencies(appDirectory, archive) {
  const expected = installedPackages(appDirectory, true);
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
