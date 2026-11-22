// electron-builder afterPack hook: fail the build loudly when embedded tooling
// is missing, and flip Electron security fuses before Windows/macOS code signing.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { FuseV1Options, FuseVersion, flipFuses } = require('@electron/fuses');

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function assertFfResources(resourcesDir, platform) {
  const ffDir = path.join(resourcesDir, 'ff');
  const exe = (name) => (platform === 'win32' ? `${name}.exe` : name);
  const missing = [exe('ffmpeg'), exe('ffprobe')].filter(
    (name) => !isFile(path.join(ffDir, name)),
  );
  const license = `${exe('ffmpeg')}.LICENSE`;
  if (!isFile(path.join(ffDir, license))) missing.push(`the GPL license text (${license})`);
  if (missing.length > 0) {
    throw new Error(
      `packaged app is missing embedded tooling in ${ffDir}: ${missing.join(', ')} - ` +
        'did the ffmpeg-ffprobe-static install step download the binaries?',
    );
  }
}

function electronBinaryPath(appOutDir, packager, platform) {
  switch (platform) {
    case 'win32':
      return path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
    case 'linux':
      return path.join(appOutDir, packager.executableName);
    case 'darwin':
    case 'mas':
      return path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
    default:
      throw new Error(`unsupported electron platform for fuses: ${platform}`);
  }
}

function securityFuseConfig(platform) {
  return {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: platform === 'darwin' || platform === 'mas',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  };
}

async function applyElectronFuses(context) {
  const binary = electronBinaryPath(
    context.appOutDir,
    context.packager,
    context.electronPlatformName,
  );
  await flipFuses(binary, securityFuseConfig(context.electronPlatformName));
  return binary;
}

module.exports = async function afterPack(context) {
  assertFfResources(
    context.packager.getResourcesDir(context.appOutDir),
    context.electronPlatformName,
  );
  await applyElectronFuses(context);
};
module.exports.assertFfResources = assertFfResources;
module.exports.applyElectronFuses = applyElectronFuses;
module.exports.electronBinaryPath = electronBinaryPath;
module.exports.securityFuseConfig = securityFuseConfig;
