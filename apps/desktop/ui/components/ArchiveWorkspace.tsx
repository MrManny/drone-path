'use client';

import { useState } from 'react';

import { FolderPlus, RefreshCw, Trash2, X } from 'lucide-react';

import { leafName } from '../../shared/errors.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import type { ArchiveWorkspaceState } from '../hooks/useArchiveWorkspace.js';
import { formatTime } from '../lib/frametime.js';
import { useTranslation } from '../lib/i18n.js';
import type { PickState } from '../lib/pickstate.js';
import { DialogShell } from './DialogShell.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';
import { OpenNotice } from './OpenNotice.js';
import type { WorkspaceMode } from './WorkspaceHeader.js';
import { WorkspaceShell } from './WorkspaceShell.js';

interface ArchiveWorkspaceProps {
  archive: ArchiveWorkspaceState;
  hasRecording: boolean;
  openState: PickState;
  onOpen: () => void;
  onOpenFolder: () => void;
  onOpenClip: (path: string) => void;
  onHelp: () => void;
  onExit: () => void;
  onDismissOpenState?: () => void;
  mode: WorkspaceMode;
  showModeSwitch: boolean;
  onModeChange: (mode: WorkspaceMode) => void;
  dialogs: Dialogs;
}

export function ArchiveWorkspace({
  archive,
  hasRecording,
  openState,
  onOpen,
  onOpenFolder,
  onOpenClip,
  onHelp,
  onExit,
  onDismissOpenState,
  mode,
  showModeSwitch,
  onModeChange,
  dialogs,
}: ArchiveWorkspaceProps) {
  const t = useTranslation();
  const [confirmPruneOpen, setConfirmPruneOpen] = useState(false);
  const {
    roots,
    offlineRoots,
    flights,
    totalCount,
    offlineCount,
    scanning,
    pruning,
    lastPrunedCount,
    scanProgress,
    error,
    removeFolder,
    rescan,
    cancelScan,
    pruneOffline,
    dismissPruneStatus,
    dismissError,
  } = archive;

  const opening = openState.kind === 'preparing';

  const scanStatusText = scanning
    ? scanProgress?.currentPath
      ? t('archiveWorkspace.scanningFile', {
          count: scanProgress.scanned,
          name: leafName(scanProgress.currentPath),
        })
      : t('archiveWorkspace.scanning', { count: scanProgress?.scanned ?? 0 })
    : scanProgress?.phase === 'done'
      ? t('archiveWorkspace.scanDone', { count: scanProgress.scanned })
      : scanProgress?.phase === 'canceled'
        ? t('archiveWorkspace.scanCanceled')
        : null;

  return (
    <WorkspaceShell
      hasRecording={hasRecording}
      opening={opening}
      durationSec={null}
      dialogs={dialogs}
      onOpen={onOpen}
      onOpenFolder={onOpenFolder}
      onHelp={onHelp}
      onExit={onExit}
      mode={mode}
      showModeSwitch={showModeSwitch}
      onModeChange={onModeChange}
      showFooterControls={false}
      stage={
        <div className="archive-stage">
          <aside className="archive-folders">
            <div className="archive-pane-header">
              <h2 className="preview-title">{t('archiveWorkspace.watchedFolders')}</h2>
              <div className="archive-folder-actions">
                <button type="button" onClick={onOpenFolder}>
                  <FolderPlus aria-hidden="true" />
                  {t('archiveWorkspace.addFolder')}
                </button>
                {roots.length > 0 ? (
                  scanning ? (
                    <button type="button" onClick={() => void cancelScan()}>
                      <X aria-hidden="true" />
                      {t('archiveWorkspace.cancelScan')}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void rescan()}>
                      <RefreshCw aria-hidden="true" />
                      {t('archiveWorkspace.rescan')}
                    </button>
                  )
                ) : null}
              </div>
            </div>

            {scanStatusText ? (
              <p className="archive-scan-status hint" role="status">
                {scanStatusText}
              </p>
            ) : null}

            {roots.length === 0 ? (
              <p className="hint">{t('archiveWorkspace.noFolders')}</p>
            ) : (
              <ul className="archive-folder-list">
                {roots.map((root) => {
                  const name = leafName(root) || root;
                  const isFolderOffline = offlineRoots.has(root);
                  return (
                    <li
                      key={root}
                      className={
                        isFolderOffline
                          ? 'archive-folder-row archive-folder-row-offline'
                          : 'archive-folder-row'
                      }
                    >
                      <div className="archive-folder-meta">
                        <div className="archive-folder-heading">
                          <span className="archive-folder-name">{name}</span>
                          {isFolderOffline ? (
                            <span className="archive-badge archive-badge-offline">
                              {t('archiveWorkspace.offlineBadge')}
                            </span>
                          ) : null}
                        </div>
                        <span className="archive-folder-path hint" title={root}>
                          {root}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="archive-folder-remove"
                        aria-label={t('archiveWorkspace.removeFolderLabel', { name })}
                        title={t('archiveWorkspace.removeFolderLabel', { name })}
                        onClick={() => void removeFolder(root)}
                      >
                        <Trash2 aria-hidden="true" />
                        {t('archiveWorkspace.removeFolder')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="archive-clips" aria-label={t('workspaceHeader.archiveMode')}>
            {openState.kind === 'preparing' || openState.kind === 'error' ? (
              <OpenNotice state={openState} onDismiss={onDismissOpenState} />
            ) : null}
            {error ? <ErrorNotice error={error} onDismiss={dismissError} /> : null}
            {lastPrunedCount !== null && lastPrunedCount > 0 ? (
              <Notice tone="info" onDismiss={dismissPruneStatus}>
                {t('archiveWorkspace.prunedOffline', { count: lastPrunedCount })}
              </Notice>
            ) : null}

            <div className="archive-clips-summary">
              <div className="archive-clips-counts">
                <span className="readout">
                  {t('archiveWorkspace.recordingCount', { count: totalCount })}
                </span>
                {offlineCount > 0 ? (
                  <span className="hint">
                    {' · '}
                    {t('archiveWorkspace.offlineCount', { count: offlineCount })}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="archive-prune-trigger"
                disabled={offlineCount === 0 || scanning || pruning}
                onClick={() => setConfirmPruneOpen(true)}
              >
                <Trash2 aria-hidden="true" />
                {t('archiveWorkspace.pruneOffline')}
              </button>
            </div>

            {flights.length === 0 ? (
              <div className="archive-empty">
                {roots.length === 0 ? (
                  <>
                    <p>{t('archiveWorkspace.emptyPrompt')}</p>
                    <button type="button" className="primary" onClick={onOpenFolder}>
                      {t('archiveWorkspace.addFolder')}
                    </button>
                  </>
                ) : (
                  <p className="hint">{t('archiveWorkspace.noRecordings')}</p>
                )}
              </div>
            ) : (
              <div className="archive-flights">
                {flights.map((flight, index) => (
                  <div key={flight.flightId} className="archive-flight">
                    <h3 className="archive-flight-title">
                      {t('archiveWorkspace.flightHeading', { index: index + 1 })}
                    </h3>
                    <ul className="archive-clip-list">
                      {flight.clips.map((clip) => {
                        const name = leafName(clip.path);
                        const isOffline = clip.availability === 'offline';
                        const durationText =
                          clip.video?.durationSec !== undefined && clip.video.durationSec !== null
                            ? formatTime(clip.video.durationSec)
                            : '--';
                        const distanceText = clip.telemetry
                          ? `${Math.round(clip.telemetry.trackDistanceM)} m`
                          : '--';
                        const badge = isOffline
                          ? t('archiveWorkspace.offlineBadge')
                          : clip.status === 'no-telemetry' || clip.status === 'no-gps'
                            ? t('archiveWorkspace.noTelemetryBadge')
                            : clip.status === 'error'
                              ? t('archiveWorkspace.errorBadge')
                              : null;
                        return (
                          <li key={clip.path}>
                            <button
                              type="button"
                              className={
                                isOffline
                                  ? 'archive-clip-row archive-clip-row-offline'
                                  : 'archive-clip-row'
                              }
                              aria-label={
                                isOffline
                                  ? t('archiveWorkspace.offlineClipLabel', { name })
                                  : t('archiveWorkspace.openClip', { name })
                              }
                              title={
                                isOffline
                                  ? t('archiveWorkspace.offlineClipHint', { path: clip.path })
                                  : undefined
                              }
                              disabled={opening || isOffline}
                              onClick={() => onOpenClip(clip.path)}
                            >
                              <div className="archive-clip-main">
                                <span className="archive-clip-name">{name}</span>
                                <span className="archive-clip-path hint" title={clip.path}>
                                  {clip.path}
                                </span>
                              </div>
                              <div className="archive-clip-meta">
                                {badge ? (
                                  <span
                                    className={
                                      isOffline
                                        ? 'archive-badge archive-badge-offline'
                                        : 'archive-badge'
                                    }
                                  >
                                    {badge}
                                  </span>
                                ) : null}
                                <span className="readout">{durationText}</span>
                                <span className="readout">{distanceText}</span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
          {confirmPruneOpen && offlineCount > 0 ? (
            <DialogShell
              title={t('archiveWorkspace.pruneOfflineTitle')}
              onClose={() => {
                if (!pruning) setConfirmPruneOpen(false);
              }}
              closeOnBackdrop={!pruning}
            >
              <Notice tone="warning">
                {t('archiveWorkspace.pruneOfflineConfirm', { count: offlineCount })}
              </Notice>
              <div className="dialog-actions">
                <button
                  type="button"
                  disabled={pruning}
                  onClick={() => setConfirmPruneOpen(false)}
                >
                  {t('archiveWorkspace.pruneOfflineCancel')}
                </button>
                <button
                  type="button"
                  className="dialog-primary"
                  disabled={pruning}
                  onClick={() => {
                    void pruneOffline().then((removed) => {
                      if (removed !== null) setConfirmPruneOpen(false);
                    });
                  }}
                >
                  {pruning
                    ? t('archiveWorkspace.pruningOffline')
                    : t('archiveWorkspace.pruneOfflineConfirmAction')}
                </button>
              </div>
            </DialogShell>
          ) : null}
        </div>
      }
    />
  );
}
