'use client';

import { useTranslation } from '../lib/i18n.js';
import { formatTime } from '../lib/frametime.js';

export type WorkspaceMode = 'archive' | 'review';

interface WorkspaceHeaderProps {
  /** Recording length in seconds; null while no recording is loaded. */
  durationSec: number | null;
  mode?: WorkspaceMode;
  showModeSwitch?: boolean;
  onModeChange?: (mode: WorkspaceMode) => void;
}

export function WorkspaceHeader({
  durationSec,
  mode,
  showModeSwitch = false,
  onModeChange,
}: WorkspaceHeaderProps) {
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
        {durationSec === null ? null : (
          <small>{t('workspaceHeader.recordingDuration', { duration: formatTime(durationSec) })}</small>
        )}
      </div>
      {showModeSwitch && mode && onModeChange ? (
        <div className="segmented header-mode-switch" role="group" aria-label={t('workspaceHeader.mode')}>
          <button
            type="button"
            className="segment"
            aria-pressed={mode === 'archive'}
            onClick={() => onModeChange('archive')}
          >
            {t('workspaceHeader.archiveMode')}
          </button>
          <button
            type="button"
            className="segment"
            aria-pressed={mode === 'review'}
            onClick={() => onModeChange('review')}
          >
            {t('workspaceHeader.reviewMode')}
          </button>
        </div>
      ) : null}
    </header>
  );
}
