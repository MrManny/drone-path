import { describe, expect, it } from 'vitest';

import type { BuildGit } from '../../ui/lib/buildversion.js';
import { formatVersion } from '../../ui/lib/buildversion.js';

describe('formatVersion', () => {
  it('keeps the plain version for a tagged release', () => {
    expect(formatVersion('0.8.1', { tagged: true, commit: 'cb40df32' })).toBe('0.8.1');
  });

  it('adds the short commit to an untagged build', () => {
    expect(formatVersion('0.8.1', { tagged: false, commit: 'cb40df32' })).toBe('0.8.1+cb40df32');
  });
});

interface FallbackCase {
  name: string;
  git: BuildGit | null;
}

describe.for<FallbackCase>([
  { name: 'git was unavailable at build time', git: null },
  { name: 'the probe found no commit', git: { tagged: false, commit: null } },
  { name: 'the probe found an empty commit', git: { tagged: false, commit: '' } },
])('falls back to the plain version when $name', ({ git }) => {
  it('shows no commit hash', () => {
    expect(formatVersion('0.8.1', git)).toBe('0.8.1');
  });
});
