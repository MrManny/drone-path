'use client';

import { DialogShell } from './DialogShell.js';
import { Notice } from './Notice.js';

export interface UpdatePromptProps {
  /** The restart is under way: the actions lock and the copy stays put. */
  restarting: boolean;
  onRestart: () => void;
  onLater: () => void;
}

// The restart prompt is a dialog like Settings and Export: one message as the
// info notice, one primary action, and dismissal means "Later" everywhere.
export function UpdatePrompt({ restarting, onRestart, onLater }: UpdatePromptProps) {
  return (
    <DialogShell
      title="Update"
      onClose={onLater}
      blockedReason={restarting ? 'The app is restarting.' : undefined}
      closeOnBackdrop={!restarting}
    >
      <Notice tone="info">
        A new version is ready to install. Restart now to finish updating, or keep
        working and the update installs when you quit.
      </Notice>
      <div className="dialog-actions">
        <button type="button" onClick={onLater} disabled={restarting}>
          Later
        </button>
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
