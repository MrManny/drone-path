'use client';

import { aboutContent } from '../lib/abouttext.js';
import type { BuildGit } from '../lib/buildversion.js';
import { useTranslation } from '../lib/i18n.js';
import { GitHubIcon } from '../icons/GitHubIcon.js';
import { DialogShell } from './DialogShell.js';

interface AboutDialogProps {
  version: string;
  git: BuildGit | null;
  onClose: () => void;
}

export function AboutDialog({ version, git, onClose }: AboutDialogProps) {
  const t = useTranslation();
  const content = aboutContent(version, git, t);
  return (
    <DialogShell title={t('aboutDialog.about')} onClose={onClose} panelClass="about-panel">
      <div className="about-body">
        <div className="brand">
          <span>drone</span>
          <span className="brand-light"> / path</span>
        </div>
        <p className="about-version">{content.versionLine}</p>
        <p className="about-license">{content.licenseLine}</p>
        <a
          className="about-link"
          href={content.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {new URL(content.websiteUrl).hostname}
        </a>
        <a
          className="about-link"
          href={content.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <GitHubIcon />
          {content.repoLabel}
        </a>
      </div>
    </DialogShell>
  );
}
