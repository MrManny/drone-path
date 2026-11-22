import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertNotArchiveDb,
  assertPathInAllowedRoots,
  canonicalizePath,
  isPathInAllowedRoots,
  isPathWithinRoot,
  resolveAllowedRoots,
} from '../src/mcp-paths.js';
import { cleanupTmpDirs, tmpDir } from '../../../test/fixtures/core.js';

afterEach(cleanupTmpDirs);

describe('resolveAllowedRoots', () => {
  it('throws when allowed roots are omitted or empty', () => {
    expect(() => resolveAllowedRoots()).toThrow(/at least one allowed root directory is required/);
    expect(() => resolveAllowedRoots([])).toThrow(/at least one allowed root directory is required/);
  });

  it('canonicalizes and deduplicates multiple root directories', () => {
    const root = tmpDir();
    const nested = path.join(root, 'a', '..');
    expect(resolveAllowedRoots([root, nested])).toEqual([fs.realpathSync(root)]);
  });

  it('rejects missing, non-directory, empty, or null-byte roots', () => {
    const root = tmpDir();
    const file = path.join(root, 'file.txt');
    fs.writeFileSync(file, 'x');

    expect(() => resolveAllowedRoots([path.join(root, 'missing')])).toThrow(
      /allowed root does not exist/,
    );
    expect(() => resolveAllowedRoots([file])).toThrow(/allowed root is not a directory/);
    expect(() => resolveAllowedRoots([''])).toThrow(/allowed root must not be empty/);
    expect(() => resolveAllowedRoots([`${root}\0evil`])).toThrow(/null byte/);
  });
});

describe('assertPathInAllowedRoots', () => {
  it('accepts the root itself and existing or future descendants', () => {
    const root = tmpDir();
    const canonicalRoot = fs.realpathSync(root);
    const clip = path.join(root, 'sub', 'clip.mp4');
    fs.mkdirSync(path.dirname(clip), { recursive: true });
    fs.writeFileSync(clip, 'mp4');

    expect(assertPathInAllowedRoots(root, [canonicalRoot])).toBe(canonicalRoot);
    expect(assertPathInAllowedRoots(clip, [canonicalRoot])).toBe(fs.realpathSync(clip));
    expect(
      assertPathInAllowedRoots(path.join(root, 'future', 'nested', 'out.csv'), [canonicalRoot]),
    ).toBe(path.join(canonicalRoot, 'future', 'nested', 'out.csv'));
  });

  it('rejects parent traversal and sibling-prefix escapes', () => {
    const parent = tmpDir();
    const root = path.join(parent, 'allowed');
    const sibling = path.join(parent, 'allowed-other');
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);
    const [canonicalRoot] = resolveAllowedRoots([root]);

    expect(() =>
      assertPathInAllowedRoots(path.join(root, '..', 'outside.mp4'), [canonicalRoot]),
    ).toThrow(/path is outside allowed roots/);
    expect(() =>
      assertPathInAllowedRoots(path.join(sibling, 'secret.mp4'), [canonicalRoot]),
    ).toThrow(/path is outside allowed roots/);
    expect(isPathInAllowedRoots(path.join(sibling, 'secret.mp4'), [canonicalRoot])).toBe(false);
  });

  it('rejects directory symlink / junction escapes outside allowed roots', () => {
    const parent = tmpDir();
    const root = path.join(parent, 'allowed');
    const outside = path.join(parent, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.mp4'), 'secret');

    const linkPath = path.join(root, 'escape-link');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(outside, linkPath, linkType);

    const [canonicalRoot] = resolveAllowedRoots([root]);
    expect(() =>
      assertPathInAllowedRoots(path.join(linkPath, 'secret.mp4'), [canonicalRoot]),
    ).toThrow(/path is outside allowed roots/);
    expect(() =>
      assertPathInAllowedRoots(path.join(linkPath, 'future-write.csv'), [canonicalRoot]),
    ).toThrow(/path is outside allowed roots/);
  });

  it('compares Windows drive/path case insensitively', () => {
    const root = canonicalizePath(tmpDir());
    if (process.platform === 'win32') {
      const upper = path.join(root, 'Clip.MP4').toUpperCase();
      expect(isPathWithinRoot(upper, root.toLowerCase())).toBe(true);
      expect(() => assertPathInAllowedRoots(upper, [root.toLowerCase()])).not.toThrow();
    } else {
      const upper = path.join(root, 'Other');
      expect(isPathWithinRoot(upper, root)).toBe(true);
    }
  });
});

describe('assertNotArchiveDb', () => {
  it('blocks overwriting the archive database and its SQLite sidecars', () => {
    const root = tmpDir();
    const db = path.join(root, 'archive.sqlite');
    fs.writeFileSync(db, 'sqlite');

    expect(() => assertNotArchiveDb(db, db)).toThrow(
      /output path cannot overwrite the archive database/,
    );
    expect(() => assertNotArchiveDb(`${db}-wal`, db)).toThrow(
      /output path cannot overwrite the archive database/,
    );
    expect(() => assertNotArchiveDb(path.join(root, 'markers.csv'), db)).not.toThrow();
  });
});
