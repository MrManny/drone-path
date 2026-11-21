const path = require('node:path');
const { ffmpegDownloadExclusions } = require('./verify-asar.cjs');

module.exports = {
  // Electron Builder checks the workspace's local node_modules before resolving ranges.
  electronVersion: require('electron/package.json').version,
  // Excluding the wrapper alone leaves its hoisted dependency tree in the ASAR.
  files: ffmpegDownloadExclusions(path.join(__dirname, '..')),
};
