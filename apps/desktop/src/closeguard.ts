import { errorMessage } from 'drone-path-core/errors';
import type { ExportOutcome } from './exportjob.js';

export interface CloseGuardDeps {
  isExportRunning(): boolean;
  cancelExport(): void;
  confirmStopExport(): Promise<boolean>;
  closeWindow(): boolean;
  quitApp(): void;
  log(message: string): void;
}

export interface CloseGuard {
  onWindowClose(event: { preventDefault(): void }): void;
  onExportSettled(outcome: ExportOutcome, notifyWindow: (outcome: ExportOutcome) => void): void;
  onWindowAllClosed(): void;
  isPromptOpen(): boolean;
  isPendingClose(): boolean;
}

/** Coordinates window-close confirmation and deferred shutdown while an export is running. */
export function createCloseGuard(deps: CloseGuardDeps): CloseGuard {
  let closePromptOpen = false;
  let pendingClose = false;

  function closeOrQuit(): void {
    if (!deps.closeWindow()) deps.quitApp();
  }

  return {
    onWindowClose(event: { preventDefault(): void }): void {
      if (pendingClose || !deps.isExportRunning()) return;
      event.preventDefault();
      if (closePromptOpen) return;
      closePromptOpen = true;
      void deps.confirmStopExport().then(
        (stop) => {
          closePromptOpen = false;
          if (!stop) return;
          // The export may have settled while the dialog was open; close
          // directly instead of setting pendingClose for an onDone that already ran.
          if (!deps.isExportRunning()) {
            closeOrQuit();
            return;
          }
          // Cancellation settles asynchronously: the close completes from the
          // job's onDone, never from a synchronous running() check.
          pendingClose = true;
          deps.cancelExport();
        },
        (err: unknown) => {
          closePromptOpen = false;
          deps.log(`close guard dialog failed: ${errorMessage(err)}`);
        },
      );
    },
    onExportSettled(outcome: ExportOutcome, notifyWindow: (outcome: ExportOutcome) => void): void {
      notifyWindow(outcome);
      if (pendingClose) {
        pendingClose = false;
        closeOrQuit();
      }
    },
    onWindowAllClosed(): void {
      if (deps.isExportRunning()) {
        pendingClose = true;
        deps.cancelExport();
        return;
      }
      deps.quitApp();
    },
    isPromptOpen: () => closePromptOpen,
    isPendingClose: () => pendingClose,
  };
}
