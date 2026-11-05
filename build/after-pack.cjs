// electron-builder afterPack hook: fail the build loudly when the embedded
// ffmpeg/ffprobe executables or their license text never made it into
// resources/ff/. electron-builder silently skips missing extraResources
// sources, so without this guard a dropped optional dependency (or a failed
// ffmpeg-ffprobe-static install download) packages green with empty tooling.
'use strict';

const fs = require('fs');
const path = require('path');

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
  const hasLicense =
    fs.existsSync(ffDir) &&
    fs
      .readdirSync(ffDir)
      .some((name) => /licen[cs]e|gpl/i.test(name) && isFile(path.join(ffDir, name)));
  if (!hasLicense) missing.push('the GPL license text');
  if (missing.length > 0) {
    throw new Error(
      `packaged app is missing embedded tooling in ${ffDir}: ${missing.join(', ')} - ` +
        'did the ffmpeg-ffprobe-static install step download the binaries?',
    );
  }
}

module.exports = async function afterPack(context) {
  assertFfResources(
    context.packager.getResourcesDir(context.appOutDir),
    context.electronPlatformName,
  );
};
module.exports.assertFfResources = assertFfResources;
