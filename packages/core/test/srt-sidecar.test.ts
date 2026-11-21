import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findSrtSidecar } from '../src/srt-sidecar.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

afterEach(cleanupTmpDirs);

describe('findSrtSidecar', () => {
  it('matches the video basename case-insensitively', () => {
    const root = tmpDir();
    const video = path.join(root, 'clip.mp4');
    fs.writeFileSync(video, '');
    const srt = path.join(root, 'CLIP.SRT');
    fs.writeFileSync(srt, '');
    expect(findSrtSidecar(video)).toBe(srt);
  });

  it('returns null when the recording has no sidecar', () => {
    const root = tmpDir();
    const video = path.join(root, 'clip.mp4');
    fs.writeFileSync(video, '');
    fs.writeFileSync(path.join(root, 'other.srt'), '');
    expect(findSrtSidecar(video)).toBeNull();
  });
});
