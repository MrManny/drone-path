import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';
import { camMetaMp4 } from '../../../test/fixtures/mp4-cammeta.js';
import { readCamMetaTrack } from '../src/mp4-cammeta.js';

afterEach(cleanupTmpDirs);

describe('readCamMetaTrack', () => {
  it.for(['ordinary', 'wide', 'identity-edit', 'rounding-tie'] as const)('reads sample bytes and PTS for %s', async (layout) => {
    const { file, buffer, packets } = camMetaMp4(layout);
    const video = path.join(tmpDir(), 'cammeta.mp4');
    writeFileSync(video, file);

    await expect(readCamMetaTrack(video, 3)).resolves.toEqual({ buffer, packets });
  });

  it.for(['fragmented', 'bad-offset', 'composition-offset', 'shifted-edit'] as const)(
    'leaves %s to the tools',
    async (layout) => {
      const video = path.join(tmpDir(), 'cammeta.mp4');
      writeFileSync(video, camMetaMp4(layout).file);

      await expect(readCamMetaTrack(video, 3)).resolves.toBeNull();
    },
  );

  it('leaves a missing track or truncated file to the tools', async () => {
    const video = path.join(tmpDir(), 'cammeta.mp4');
    const { file } = camMetaMp4();
    writeFileSync(video, file);
    await expect(readCamMetaTrack(video, 4)).resolves.toBeNull();

    writeFileSync(video, file.subarray(0, -1));
    await expect(readCamMetaTrack(video, 3)).resolves.toBeNull();
  });
});
