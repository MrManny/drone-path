'use client';

import { DialogShell } from './DialogShell.js';
import { Notice } from './Notice.js';

interface UpdatePromptProps {
  restarting: boolean;
  /** Backend message of a failed restart; null while none failed. */
  failure: string | null;
  onRestart: () => void;
  onLater: () => void;
}

export function UpdatePrompt({ restarting, failure, onRestart, onLater }: UpdatePromptProps) {
  return (
    <DialogShell
      title="Update"
      onClose={onLater}
      blockedReason={restarting ? 'The app is restarting.' : undefined}
      closeOnBackdrop={!restarting}
    >
      {failure ? (
        <Notice tone="danger" details={failure}>
          The restart failed. Try again, or install the update when you quit.
        </Notice>
      ) : (
        <Notice tone="info">
          A new version is ready to install. Restart now to finish updating, or keep
          working and the update installs when you quit.
        </Notice>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="dialog-primary"
          onClick={onRestart}
          disabled={restarting}
        >
          {restarting ? 'Restarting…' : 'Restart now'}
        </button>
      </div>
    </DialogShell>
  );
}
