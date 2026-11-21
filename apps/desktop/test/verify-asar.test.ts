import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

const { ffmpegDownloadExclusions, verifyPackageDependencies } = createRequire(import.meta.url)('../build/verify-asar.cjs') as {
  ffmpegDownloadExclusions: (appDirectory: string) => string[];
  verifyPackageDependencies: (appDirectory: string, archive: string) => string[];
};

function writePackage(directory: string, manifest: object): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest));
}

function fixture() {
  const root = tmpDir();
  const desktop = path.join(root, 'apps', 'desktop');
  const archive = path.join(root, 'app.asar');
  writePackage(desktop, {
    name: 'drone-path-desktop',
    dependencies: { 'drone-path-engine': '~1.0.0' },
    optionalDependencies: {
      'ffmpeg-ffprobe-static': '~7.1.0',
      'platform-tools': '~1.0.0',
    },
    devDependencies: { electron: '~45.3.0' },
  });
  writePackage(path.join(root, 'node_modules', 'drone-path-engine'), {
    name: 'drone-path-engine',
    version: '1.0.0',
    dependencies: { 'playwright-core': '~1.0.0', '@scope/helper': '~2.0.0' },
  });
  writePackage(path.join(root, 'node_modules', 'playwright-core'), {
    name: 'playwright-core',
    version: '1.0.0',
  });
  const helper = { name: '@scope/helper', version: '2.0.0' };
  writePackage(path.join(root, 'node_modules', '@scope', 'helper'), helper);
  writePackage(path.join(root, 'node_modules', 'ffmpeg-ffprobe-static'), {
    name: 'ffmpeg-ffprobe-static',
    version: '7.1.0',
    dependencies: { '@scope/helper': '~2.0.0', 'download-only': '~1.0.0' },
  });
  writePackage(path.join(root, 'node_modules', 'download-only'), {
    name: 'download-only',
    version: '1.0.0',
  });
  writePackage(path.join(root, 'node_modules', 'electron'), { name: 'electron', version: '45.3.1' });

  const engine = path.join(archive, 'node_modules', 'drone-path-engine');
  writePackage(engine, { name: 'drone-path-engine', version: '1.0.0' });
  writePackage(path.join(engine, 'node_modules', '@scope', 'helper'), helper);
  return {
    desktop,
    root,
    archive,
    playwright: path.join(archive, 'node_modules', 'playwright-core'),
  };
}

afterEach(cleanupTmpDirs);

describe('the desktop ASAR dependency inventory', () => {
  it('excludes FFmpeg download-only packages and preserves shared dependencies', () => {
    const { desktop } = fixture();
    expect(ffmpegDownloadExclusions(desktop)).toEqual([
      '!**/node_modules/download-only/**',
      '!**/node_modules/ffmpeg-ffprobe-static/**',
    ]);
  });

  it('includes transitive and nested scoped packages and skips the external tools wrapper', () => {
    const { desktop, archive, playwright } = fixture();
    writePackage(playwright, { name: 'playwright-core', version: '1.0.0' });
    expect(verifyPackageDependencies(desktop, archive)).toEqual([
      '@scope/helper@2.0.0', 'drone-path-engine@1.0.0', 'playwright-core@1.0.0',
    ]);
  });

  it('detects a required package missing from the ASAR', () => {
    const { desktop, archive } = fixture();
    expect(() => verifyPackageDependencies(desktop, archive)).toThrow(/missing: playwright-core@1.0.0/);
  });

  it('distinguishes a packaged dependency with the wrong version', () => {
    const { desktop, archive, playwright } = fixture();
    writePackage(playwright, { name: 'playwright-core', version: '2.0.0' });
    expect(() => verifyPackageDependencies(desktop, archive)).toThrow(
      /missing: playwright-core@1.0.0\s+unexpected: playwright-core@2.0.0/,
    );
  });

  it.each(['electron', 'download-only', 'ffmpeg-ffprobe-static'])(
    'rejects unexpected packaged dependency %s',
    (name) => {
      const { desktop, archive, playwright } = fixture();
      writePackage(playwright, { name: 'playwright-core', version: '1.0.0' });
      writePackage(path.join(archive, 'node_modules', name), { name, version: '1.0.0' });
      expect(() => verifyPackageDependencies(desktop, archive)).toThrow(
        `unexpected: ${name}@1.0.0`,
      );
    },
  );

  it('requires optional dependencies that npm selected for the platform', () => {
    const { desktop, root, archive, playwright } = fixture();
    const optional = { name: 'platform-tools', version: '1.0.0' };
    writePackage(path.join(root, 'node_modules', optional.name), optional);
    writePackage(playwright, { name: 'playwright-core', version: '1.0.0' });
    expect(() => verifyPackageDependencies(desktop, archive)).toThrow(/missing: platform-tools@1.0.0/);
    writePackage(path.join(archive, 'node_modules', optional.name), optional);
    expect(verifyPackageDependencies(desktop, archive)).toContain('platform-tools@1.0.0');
  });
});
