const path = require('node:path');
const process = require('node:process');
const { ffmpegDownloadExclusions } = require('./verify-asar.cjs');

const hasWinSigningConfig = Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK);

module.exports = {
  // Electron Builder checks the workspace's local node_modules before resolving ranges.
  electronVersion: require('electron/package.json').version,
  // Excluding the wrapper alone leaves its hoisted dependency tree in the ASAR.
  files: ffmpegDownloadExclusions(path.join(__dirname, '..')),
  win: {
    // Fail the Windows build instead of shipping an unsigned release when a
    // signing certificate is configured.
    forceCodeSigning: hasWinSigningConfig,
  },
};
