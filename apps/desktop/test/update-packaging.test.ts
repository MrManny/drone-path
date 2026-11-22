import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const engine = JSON.parse(fs.readFileSync(path.join(root, '..', '..', 'packages', 'engine', 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTmpDirs();
});

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

describe('the npm package stays Electron-free', () => {
  it('keeps electron a development dependency of the desktop only', () => {
    expect(pkg.dependencies.electron).toBeUndefined();
    expect(pkg.devDependencies.electron).toBeTruthy();
    const cli = JSON.parse(fs.readFileSync(path.join(root, '..', '..', 'packages', 'cli', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(cli.dependencies.electron).toBeUndefined();
    expect(cli.dependencies['electron-updater']).toBeUndefined();
  });

  it('keeps Electron and updater code out of the CLI and shared sources', () => {
    const files = [
      ...sourceFiles(path.join(root, '..', '..', 'packages', 'cli', 'src')),
      ...sourceFiles(path.join(root, '..', '..', 'packages', 'core', 'src')),
      ...sourceFiles(path.join(root, '..', '..', 'packages', 'engine', 'src')),
      ...sourceFiles(path.join(root, '..', '..', 'packages', 'cli', 'bin')),
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
      'artifactName: drone-path-${version}-${os}-${arch}-setup.${ext}',
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
      ['../../node_modules/ffmpeg-ffprobe-static/ffmpeg.exe', 'to: ff/ffmpeg.exe'],
      ['../../node_modules/ffmpeg-ffprobe-static/ffprobe.exe', 'to: ff/ffprobe.exe'],
      ['../../node_modules/ffmpeg-ffprobe-static/ffmpeg.exe.LICENSE', 'to: ff/ffmpeg.exe.LICENSE'],
      ['../../node_modules/ffmpeg-ffprobe-static/ffmpeg', 'to: ff/ffmpeg'],
      ['../../node_modules/ffmpeg-ffprobe-static/ffprobe', 'to: ff/ffprobe'],
      ['../../node_modules/ffmpeg-ffprobe-static/ffmpeg.LICENSE', 'to: ff/ffmpeg.LICENSE'],
    ]) {
      expect(builderConfig).toContain(source);
      expect(builderConfig).toContain(target);
    }
  });

  it('wires the afterPack guard into the build', () => {
    expect(builderConfig).toContain('afterPack: build/after-pack.cjs');
    expect(builderConfig).toContain('THIRD-PARTY-NOTICES.md');
  });
});

describe('the packaged desktop app ships playwright-core', () => {
  it('keeps playwright-core a normal runtime dependency', () => {
    expect(engine.dependencies['playwright-core']).toMatch(/^~\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies['playwright-core']).toBeUndefined();
  });

  it('keeps playwright-core in the packaged file set', () => {
    expect(builderConfig).not.toContain('playwright-core');
  });
});

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
    ['linux', ['ffmpeg', 'ffprobe', 'unrelated.LICENSE'], 'ffmpeg.LICENSE'],
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

describe('Electron security fuses and Windows signing configuration', () => {
  const req = createRequire(import.meta.url);
  const afterPack = req(path.join(root, 'build', 'after-pack.cjs')) as ((
    context: {
      appOutDir: string;
      electronPlatformName: string;
      packager: {
        getResourcesDir: (appOutDir: string) => string;
        appInfo: { productFilename: string };
        executableName: string;
      };
    },
  ) => Promise<void>) & {
    electronBinaryPath: (
      appOutDir: string,
      packager: { appInfo: { productFilename: string }; executableName: string },
      platform: string,
    ) => string;
  };
  const { verifyElectronFuses } = req(path.join(root, 'build', 'verify-fuses.cjs')) as {
    verifyElectronFuses: (binaryPath: string) => Promise<string[]>;
  };
  const { SENTINEL, FuseState } = req('@electron/fuses/dist/constants.js') as {
    SENTINEL: string;
    FuseState: { DISABLE: number; ENABLE: number };
  };

  function writeSyntheticElectronBinary(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Default Electron v1 fuse wire: 8 fuses starting enabled/disabled opposite to hardened state.
    const wire = Buffer.from([
      1, 8,
      FuseState.ENABLE,  // RunAsNode
      FuseState.DISABLE, // EnableCookieEncryption
      FuseState.ENABLE,  // EnableNodeOptionsEnvironmentVariable
      FuseState.ENABLE,  // EnableNodeCliInspectArguments
      FuseState.DISABLE, // EnableEmbeddedAsarIntegrityValidation
      FuseState.DISABLE, // OnlyLoadAppFromAsar
      FuseState.DISABLE, // LoadBrowserProcessSpecificV8Snapshot
      FuseState.ENABLE,  // GrantFileProtocolExtraPrivileges
    ]);
    fs.writeFileSync(filePath, Buffer.concat([Buffer.from('stub-'), Buffer.from(SENTINEL), wire]));
  }

  it('pins @electron/fuses as a patch-level devDependency', () => {
    expect(pkg.devDependencies['@electron/fuses']).toMatch(/^~\d+\.\d+\.\d+$/);
  });

  it('configures SHA-256 Authenticode verification in electron-builder.yml', () => {
    expect(builderConfig).toContain('verifyUpdateCodeSignature: true');
    expect(builderConfig).toContain('signingHashAlgorithms:');
    expect(builderConfig).toContain('- sha256');
  });

  it('enables forceCodeSigning only when WIN_CSC_LINK or CSC_LINK is set', () => {
    const configPath = path.join(root, 'build', 'electron-config.cjs');
    const loadConfig = () => {
      delete req.cache[req.resolve(configPath)];
      return req(configPath) as { win: { forceCodeSigning: boolean } };
    };

    vi.stubEnv('WIN_CSC_LINK', '');
    vi.stubEnv('CSC_LINK', '');
    expect(loadConfig().win.forceCodeSigning).toBe(false);

    vi.stubEnv('WIN_CSC_LINK', 'base64-pfx');
    expect(loadConfig().win.forceCodeSigning).toBe(true);

    vi.stubEnv('WIN_CSC_LINK', '');
    vi.stubEnv('CSC_LINK', 'base64-pfx');
    expect(loadConfig().win.forceCodeSigning).toBe(true);
  });

  it.each([
    ['win32', 'Drone Path.exe'],
    ['linux', 'drone-path'],
  ] as const)('flips and verifies security fuses in %s packaged binary via afterPack', async (platform, binName) => {
    const appOutDir = path.join(tmpDir(), `${platform}-unpacked`);
    const resourcesDir = path.join(appOutDir, 'resources');
    const ffDir = path.join(resourcesDir, 'ff');
    fs.mkdirSync(ffDir, { recursive: true });
    const exe = (name: string) => (platform === 'win32' ? `${name}.exe` : name);
    for (const file of [exe('ffmpeg'), exe('ffprobe'), `${exe('ffmpeg')}.LICENSE`]) {
      fs.writeFileSync(path.join(ffDir, file), 'x');
    }

    const packager = {
      getResourcesDir: () => resourcesDir,
      appInfo: { productFilename: 'Drone Path' },
      executableName: 'drone-path',
    };
    const binaryPath = afterPack.electronBinaryPath(appOutDir, packager, platform);
    expect(binaryPath).toBe(path.join(appOutDir, binName));
    writeSyntheticElectronBinary(binaryPath);

    await expect(verifyElectronFuses(binaryPath)).rejects.toThrow(/mismatch/);
    await afterPack({ appOutDir, electronPlatformName: platform, packager });
    await expect(verifyElectronFuses(binaryPath)).resolves.toEqual([
      'RunAsNode',
      'EnableNodeOptionsEnvironmentVariable',
      'EnableNodeCliInspectArguments',
      'EnableEmbeddedAsarIntegrityValidation',
      'OnlyLoadAppFromAsar',
    ]);
  });
});
