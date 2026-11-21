import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSrtSidecarLookup, findSrtSidecar } from '../src/srt-sidecar.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

afterEach(cleanupTmpDirs);

it('reuses a directory lookup and lets a new lookup see newly added sidecars', async () => {
  const root = tmpDir();
  const lookup = createSrtSidecarLookup();
  const first = path.join(root, 'FIRST.SRT');
  const second = path.join(root, 'Second.srt');
  const secondVideo = path.join(root, 'second.mp4');
  fs.writeFileSync(first, '');
  expect(await lookup(path.join(root, 'first.mp4'))).toBe(first);
  fs.writeFileSync(second, '');
  expect(await lookup(secondVideo)).toBeNull();
  expect(await createSrtSidecarLookup()(secondVideo)).toBe(second);
});

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
