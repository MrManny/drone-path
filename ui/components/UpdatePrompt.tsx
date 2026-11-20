'use client';

import { useTranslation } from '../lib/i18n.js';
import { DialogShell } from './DialogShell.js';
import { Notice } from './Notice.js';
import { ProgressBar } from './ProgressBar.js';

interface UpdatePromptProps {
  restarting: boolean;
  /** Backend message of a failed restart; null while none failed. */
  failure: string | null;
  onRestart: () => void;
  onLater: () => void;
}

export function UpdatePrompt({ restarting, failure, onRestart, onLater }: UpdatePromptProps) {
  const t = useTranslation();
  return (
    <DialogShell
      title={t('updatePrompt.update')}
      onClose={onLater}
      blockedReason={restarting ? t('updatePrompt.busyClose') : undefined}
      closeOnBackdrop={!restarting}
    >
      {failure ? (
        <Notice tone="danger" details={failure}>
          {t('updatePrompt.restartFailure')}
        </Notice>
      ) : (
        <Notice tone="info">
          {t('updatePrompt.ready')}
        </Notice>
      )}
      <div className={restarting ? 'dialog-busy' : undefined}>
        {restarting ? <ProgressBar label={t('updatePrompt.restartProgress')} percent={null} /> : null}
        <p className="phase-status" role="status">
          {restarting ? t('updatePrompt.restarting') : ''}
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onLater} disabled={restarting}>
          {t('updatePrompt.later')}
        </button>
        <button
          type="button"
          className="dialog-primary"
          onClick={onRestart}
          disabled={restarting}
        >
          {t('updatePrompt.restartNow')}
        </button>
      </div>
    </DialogShell>
  );
}
