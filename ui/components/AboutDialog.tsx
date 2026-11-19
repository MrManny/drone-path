'use client';

import { useTranslation } from '../lib/i18n.js';
import type { AboutContent } from '../lib/abouttext.js';
import { GitHubIcon } from '../icons/GitHubIcon.js';
import { DialogShell } from './DialogShell.js';

interface AboutDialogProps {
  content: AboutContent;
  onClose: () => void;
}

export function AboutDialog({ content, onClose }: AboutDialogProps) {
  const t = useTranslation();
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
          className="about-repo"
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
