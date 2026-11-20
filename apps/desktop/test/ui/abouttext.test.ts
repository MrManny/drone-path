import { describe, expect, it } from 'vitest';

import type { BuildGit } from '../../ui/lib/buildversion.js';
import { aboutContent } from '../../ui/lib/abouttext.js';

interface ContentCase {
  name: string;
  git: BuildGit | null;
  versionLine: string;
}

describe.for<ContentCase>([
  {
    name: 'an untagged build',
    git: { tagged: false, commit: 'cb40df32' },
    versionLine: 'Version 0.8.1+cb40df32',
  },
  {
    name: 'a tagged release',
    git: { tagged: true, commit: 'cb40df32' },
    versionLine: 'Version 0.8.1',
  },
  {
    name: 'a build without git facts',
    git: null,
    versionLine: 'Version 0.8.1',
  },
])('maps $name to the dialog copy', ({ git, versionLine }) => {
  it('states the version, license and repository', () => {
    expect(aboutContent('0.8.1', git)).toEqual({
      versionLine,
      licenseLine: 'MIT license',
      repoLabel: 'MrManny/drone-path',
      repoUrl: 'https://github.com/MrManny/drone-path',
    });
  });
});

describe('aboutContent', () => {
  it('keeps the repository label and URL aligned', () => {
    const content = aboutContent('0.8.1', null);
    expect(content.repoUrl.endsWith(content.repoLabel)).toBe(true);
  });
});
