import { tEnglish } from '../../shared/desktop-i18n/loader.js';
import type { Translate } from '../../shared/desktop-i18n/loader.js';
import type { BuildGit } from './buildversion.js';
import { formatVersion } from './buildversion.js';

/** The copy the About dialog shows. */
export interface AboutContent {
  versionLine: string;
  licenseLine: string;
  websiteUrl: string;
  repoLabel: string;
  repoUrl: string;
}

export function aboutContent(version: string, git: BuildGit | null, t: Translate = tEnglish): AboutContent {
  return {
    versionLine: t('abouttext.version', { version: formatVersion(version, git) }),
    licenseLine: t('abouttext.license'),
    websiteUrl: 'https://www.dronepath.dev/',
    repoLabel: 'MrManny/drone-path',
    repoUrl: 'https://github.com/MrManny/drone-path',
  };
}
