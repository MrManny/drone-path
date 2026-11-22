'use client';

import { useTranslation } from '../lib/i18n.js';
import { formatTime } from '../lib/frametime.js';

interface WorkspaceHeaderProps {
  /** Recording length in seconds; null while no recording is loaded. */
  durationSec: number | null;
}

export function WorkspaceHeader({ durationSec }: WorkspaceHeaderProps) {
  const t = useTranslation();
  return (
    <header className="workspace-header">
      <div className="brand">
        <span>drone</span>
        <span className="brand-light"> / path</span>
      </div>
      <div className="header-divider" />
      <div className="header-project">
        <h1 className="preview-title">{t('workspaceHeader.flightWorkspace')}</h1>
        {durationSec === null ? null : <small>{t('workspaceHeader.recordingDuration', { duration: formatTime(durationSec) })}</small>}
      </div>
    </header>
  );
}
