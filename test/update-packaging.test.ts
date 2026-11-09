import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpDirs, tmpDir } from './fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

afterEach(cleanupTmpDirs);

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
    expect(builderConfig).toContain('repo: drone-path');
  });

  it('gives the NSIS setup its own artifact name', () => {
    expect(builderConfig).toContain(
      'artifactName: ${name}-${version}-${os}-${arch}-setup.${ext}',
    );
  });
});

describe('the packaged desktop app embeds ffmpeg/ffprobe', () => {
  it('pins ffmpeg-ffprobe-static as a patch-level optional dependency', () => {
    expect(pkg.optionalDependencies['ffmpeg-ffprobe-static']).toMatch(
      /^~\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
    );
  });

  it('ships the binaries and the release license text as extraResources outside the asar', () => {
    for (const [source, target] of [
      ['node_modules/ffmpeg-ffprobe-static/ffmpeg.exe', 'to: ff/ffmpeg.exe'],
      ['node_modules/ffmpeg-ffprobe-static/ffprobe.exe', 'to: ff/ffprobe.exe'],
      ['node_modules/ffmpeg-ffprobe-static/ffmpeg.exe.LICENSE', 'to: ff/ffmpeg.exe.LICENSE'],
      ['node_modules/ffmpeg-ffprobe-static/ffmpeg', 'to: ff/ffmpeg'],
      ['node_modules/ffmpeg-ffprobe-static/ffprobe', 'to: ff/ffprobe'],
      ['node_modules/ffmpeg-ffprobe-static/ffmpeg.LICENSE', 'to: ff/ffmpeg.LICENSE'],
    ]) {
      expect(builderConfig).toContain(source);
      expect(builderConfig).toContain(target);
    }
  });

  it('keeps the download package out of the asar file set', () => {
    expect(builderConfig).toContain('"!node_modules/ffmpeg-ffprobe-static/**"');
  });

  it('wires the afterPack guard into the build', () => {
    expect(builderConfig).toContain('afterPack: build/after-pack.cjs');
    expect(builderConfig).toContain('THIRD-PARTY-NOTICES.md');
  });
});

// electron-builder silently skips missing extraResources sources: without the
// guard, a dropped optional dependency packages green with empty tooling.
describe('the afterPack guard', () => {
  const guard = createRequire(import.meta.url)(path.join(root, 'build', 'after-pack.cjs')) as {
    assertFfResources: (resourcesDir: string, platform: string) => void;
  };

  function resourcesWith(ffFiles: readonly string[]): string {
    const dir = path.join(tmpDir(), 'resources');
    const ff = path.join(dir, 'ff');
    fs.mkdirSync(ff, { recursive: true });
    for (const name of ffFiles) fs.writeFileSync(path.join(ff, name), 'x');
    return dir;
  }

  it.each([
    ['win32', ['ffmpeg.exe', 'ffprobe.exe', 'ffmpeg.exe.LICENSE']],
    ['linux', ['ffmpeg', 'ffprobe', 'ffmpeg.LICENSE']],
  ] as const)('accepts a complete %s tool set', (platform, files) => {
    expect(() => guard.assertFfResources(resourcesWith(files), platform)).not.toThrow();
  });

  it.each([
    ['win32', ['ffmpeg.exe', 'ffmpeg.exe.LICENSE'], 'ffprobe.exe'],
    ['linux', ['ffmpeg', 'ffprobe'], 'the GPL license text'],
    ['win32', [] as const, 'ffmpeg.exe'],
  ] as const)('rejects the %s tool set missing %s', (platform, files, missing) => {
    expect(() => guard.assertFfResources(resourcesWith(files), platform)).toThrow(missing);
  });

  it('names the ff directory and the install step in the error', () => {
    expect(() => guard.assertFfResources(resourcesWith([]), 'linux')).toThrow(
      /missing embedded tooling.*ffmpeg-ffprobe-static/,
    );
  });
});
