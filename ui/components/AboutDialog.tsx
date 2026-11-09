'use client';

import type { AboutContent } from '../lib/abouttext.js';
import { GitHubIcon } from '../icons/GitHubIcon.js';
import { DialogShell } from './DialogShell.js';

export interface AboutDialogProps {
  content: AboutContent;
  onClose: () => void;
}

export function AboutDialog({ content, onClose }: AboutDialogProps) {
  return (
    <DialogShell title="About" onClose={onClose} panelClass="about-panel">
      <div className="about-body">
        <div className="brand">
          <span className="brand-name">drone</span>
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
