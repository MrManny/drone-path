// Verify that the packaged Electron executable has the required security fuses flipped.
'use strict';

const path = require('node:path');
const process = require('node:process');

const { FuseV1Options, FuseVersion, getCurrentFuseWire } = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants.js');

const EXPECTED_FUSE_STATES = [
  ['RunAsNode', FuseV1Options.RunAsNode, FuseState.DISABLE],
  ['EnableNodeOptionsEnvironmentVariable', FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  ['EnableNodeCliInspectArguments', FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  ['EnableEmbeddedAsarIntegrityValidation', FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  ['OnlyLoadAppFromAsar', FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
];

async function verifyElectronFuses(binaryPath) {
  const wire = await getCurrentFuseWire(binaryPath);
  if (wire.version !== FuseVersion.V1) {
    throw new Error(`unexpected Electron fuse wire version: ${wire.version}`);
  }
  const mismatches = EXPECTED_FUSE_STATES
    .filter(([, option, expected]) => wire[option] !== expected)
    .map(([label, option, expected]) => `${label} (expected ${expected}, got ${wire[option]})`);
  if (mismatches.length > 0) {
    throw new Error(`packaged Electron fuses mismatch in ${binaryPath}: ${mismatches.join(', ')}`);
  }
  return EXPECTED_FUSE_STATES.map(([label]) => label);
}

if (require.main === module) {
  (async () => {
    try {
      const [binary] = process.argv.slice(2);
      if (!binary) throw new Error('usage: node build/verify-fuses.cjs <path-to-packaged-binary>');
      const verified = await verifyElectronFuses(path.resolve(binary));
      process.stdout.write(`verified desktop Electron fuses: ${verified.join(', ')}\n`);
    } catch (error) {
      process.stderr.write(`[drone-path] ERROR: ${error.message}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = { EXPECTED_FUSE_STATES, verifyElectronFuses };
