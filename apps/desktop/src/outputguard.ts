import path from 'node:path';

import { codedDesktopError } from 'drone-path-desktop/shared/errors';

import { isRecord } from 'drone-path-core/validation';

// Pure name rule for save dialogs: the typed name stands as typed when it
// already ends in one of the accepted extensions (any case); otherwise the
// default extension is appended to it as typed, so "notes.csv" becomes
// "notes.csv.json". The dialogs that report the result show this final name,
// so the append is never silent.
export function resolveSavePath(
  typedPath: string,
  extensions: readonly string[],
  defaultExtension: string,
): string {
  const lower = typedPath.toLowerCase();
  return extensions.some((extension) => lower.endsWith(`.${extension}`))
    ? typedPath
    : `${typedPath}.${defaultExtension}`;
}

export interface OutputGuard {
  clearPending(): void;
  clearPendingExport(): void;
  approveExport(outPath: string): void;
  consumeExport(outPath: string): string;
  recordExportOut(outPath: string): void;
  clearPendingTrack(): void;
  approveTrack(outPath: string): void;
  consumeTrack(outPath: string): string;
  recordTrackOut(outPath: string): void;
  clearPendingArchiveExport(): void;
  approveArchiveExport(outPath: string): void;
  consumeArchiveExport(outPath: string): string;
  recordArchiveExportOut(outPath: string): void;
  knownOutputOf(payload: unknown): string;
}

function assertApproved(expected: string | null, outPath: string): string {
  if (typeof expected !== 'string' || !path.isAbsolute(expected) || outPath !== expected) {
    throw codedDesktopError('OUTPUT_NOT_APPROVED', 'output path was not approved by save dialog');
  }
  return expected;
}

function createApprovalSlot() {
  let pending: string | null = null;
  let last: string | null = null;
  return {
    clearPending: (): void => {
      pending = null;
    },
    approve: (outPath: string): void => {
      pending = outPath;
    },
    consume: (outPath: string): string => {
      const expected = pending;
      pending = null;
      return assertApproved(expected, outPath);
    },
    record: (outPath: string): void => {
      last = outPath;
    },
    matches: (outPath: string): boolean => outPath === last,
  };
}

/** Tracks dialog-approved export/track/archive save paths and the reveal/open output allowlist. */
export function createOutputGuard(): OutputGuard {
  const exportSlot = createApprovalSlot();
  const trackSlot = createApprovalSlot();
  const archiveExportSlot = createApprovalSlot();

  return {
    clearPending(): void {
      exportSlot.clearPending();
      trackSlot.clearPending();
      archiveExportSlot.clearPending();
    },
    clearPendingExport: exportSlot.clearPending,
    approveExport: exportSlot.approve,
    consumeExport: exportSlot.consume,
    recordExportOut: exportSlot.record,
    clearPendingTrack: trackSlot.clearPending,
    approveTrack: trackSlot.approve,
    consumeTrack: trackSlot.consume,
    recordTrackOut: trackSlot.record,
    clearPendingArchiveExport: archiveExportSlot.clearPending,
    approveArchiveExport: archiveExportSlot.approve,
    consumeArchiveExport: archiveExportSlot.consume,
    recordArchiveExportOut: archiveExportSlot.record,
    knownOutputOf(payload: unknown): string {
      const out = isRecord(payload) ? payload.out : null;
      if (
        typeof out !== 'string' ||
        (!exportSlot.matches(out) && !trackSlot.matches(out) && !archiveExportSlot.matches(out))
      ) {
        throw codedDesktopError('UNKNOWN_OUTPUT', 'unknown output');
      }
      return out;
    },
  };
}
