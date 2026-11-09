import type { BuildGit } from './buildversion.js';
import { formatVersion } from './buildversion.js';

/** The copy the About dialog shows. */
export interface AboutContent {
  versionLine: string;
  licenseLine: string;
  repoLabel: string;
  repoUrl: string;
}

export function aboutContent(version: string, git: BuildGit | null): AboutContent {
  return {
    versionLine: `Version ${formatVersion(version, git)}`,
    licenseLine: 'MIT license',
    repoLabel: 'MrManny/drone-path',
    repoUrl: 'https://github.com/MrManny/drone-path',
  };
}
