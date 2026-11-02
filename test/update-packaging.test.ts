import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

describe('the npm package stays Electron-free', () => {
  it('keeps electron a development dependency only', () => {
    expect(pkg.dependencies.electron).toBeUndefined();
    expect(pkg.devDependencies.electron).toBeTruthy();
  });

  it('keeps Electron and updater code out of the CLI and shared sources', () => {
    const files = [
      ...sourceFiles(path.join(root, 'src')),
      ...sourceFiles(path.join(root, 'bin')),
    ];
    const importPattern = /from ['"]electron(?:-updater)?['"]|require\(['"]electron(?:-updater)?['"]\)/;
    const offenders = files.filter((file) => importPattern.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('the packaged desktop app can self-update', () => {
  it('pins electron-updater as a production dependency', () => {
    expect(pkg.dependencies['electron-updater']).toMatch(/^~\d+\.\d+\.\d+$/);
  });

  it('declares the GitHub release feed', () => {
    expect(builderConfig).toContain('provider: github');
    expect(builderConfig).toContain('owner: MrManny');
    expect(builderConfig).toContain('repo: neo2-flightpath');
  });

  it('gives the NSIS setup its own artifact name', () => {
    expect(builderConfig).toContain(
      'artifactName: ${name}-${version}-${os}-${arch}-setup.${ext}',
    );
  });
});
