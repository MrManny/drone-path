'use client';

import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FolderPlus, RefreshCw, Trash2, X } from 'lucide-react';

import type { MapStyle } from 'drone-path-engine/config';
import { leafName } from '../../shared/errors.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import type { ArchiveWorkspaceState } from '../hooks/useArchiveWorkspace.js';
import { formatTime } from '../lib/frametime.js';
import { useTranslation } from '../lib/i18n.js';
import type { PickState } from '../lib/pickstate.js';
import { ArchiveMap } from './ArchiveMap.js';
import { ErrorNotice } from './ErrorNotice.js';
import { OpenNotice } from './OpenNotice.js';
import type { WorkspaceMode } from './WorkspaceHeader.js';
import { WorkspaceShell } from './WorkspaceShell.js';

interface ArchiveWorkspaceProps {
  archive: ArchiveWorkspaceState;
  hasRecording: boolean;
  openState: PickState;
  mapStyle?: MapStyle;
  onMapStyleChange?: (style: MapStyle) => void;
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
  mapStyle = 'satellite',
  onMapStyleChange,
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
  const {
    roots,
    flights,
    totalCount,
    offlineCount,
    scanning,
    scanProgress,
    error,
    setViewportBbox,
    removeFolder,
    rescan,
    cancelScan,
    dismissError,
  } = archive;

  const [selectedClipPath, setSelectedClipPath] = useState<string | null>(null);
  const clipButtonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const opening = openState.kind === 'preparing';

  const handleSelectClipFromMap = useCallback((clipPath: string) => {
    setSelectedClipPath(clipPath);
    const button = clipButtonRefs.current.get(clipPath);
    button?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const handleClipListKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...clipButtonRefs.current.values()].filter(
      (btn): btn is HTMLButtonElement => btn !== null && !btn.disabled,
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex === -1) return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
  }, []);

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
          <aside className="archive-sidebar">
            <section className="archive-folders">
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
                    return (
                      <li key={root} className="archive-folder-row">
                        <div className="archive-folder-meta">
                          <span className="archive-folder-name">{name}</span>
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
            </section>

            <section
              className="archive-clips"
              aria-label={t('workspaceHeader.archiveMode')}
              onKeyDown={handleClipListKeyDown}
            >
              {openState.kind === 'preparing' || openState.kind === 'error' ? (
                <OpenNotice state={openState} onDismiss={onDismissOpenState} />
              ) : null}
              {error ? <ErrorNotice error={error} onDismiss={dismissError} /> : null}

              <div className="archive-clips-summary">
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
                          const isSelected = selectedClipPath === clip.path;
                          const durationText =
                            clip.video?.durationSec !== undefined && clip.video.durationSec !== null
                              ? formatTime(clip.video.durationSec)
                              : '--';
                          const distanceText = clip.telemetry
                            ? `${Math.round(clip.telemetry.trackDistanceM)} m`
                            : '--';
                          const badge =
                            clip.availability === 'offline'
                              ? t('archiveWorkspace.offlineBadge')
                              : clip.status === 'no-telemetry' || clip.status === 'no-gps'
                                ? t('archiveWorkspace.noTelemetryBadge')
                                : clip.status === 'error'
                                  ? t('archiveWorkspace.errorBadge')
                                  : null;
                          return (
                            <li key={clip.path}>
                              <button
                                ref={(el) => {
                                  if (el) clipButtonRefs.current.set(clip.path, el);
                                  else clipButtonRefs.current.delete(clip.path);
                                }}
                                type="button"
                                className={`archive-clip-row${isSelected ? ' is-selected' : ''}`}
                                data-selected={isSelected ? 'true' : undefined}
                                aria-label={t('archiveWorkspace.openClip', { name })}
                                disabled={opening}
                                onFocus={() => setSelectedClipPath(clip.path)}
                                onMouseEnter={() => setSelectedClipPath(clip.path)}
                                onClick={() => {
                                  setSelectedClipPath(clip.path);
                                  onOpenClip(clip.path);
                                }}
                              >
                                <div className="archive-clip-main">
                                  <span className="archive-clip-name">{name}</span>
                                  <span className="archive-clip-path hint" title={clip.path}>
                                    {clip.path}
                                  </span>
                                </div>
                                <div className="archive-clip-meta">
                                  {badge ? <span className="archive-badge">{badge}</span> : null}
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
          </aside>

          <section className="archive-map-pane">
            <ArchiveMap
              flights={flights}
              style={mapStyle}
              selectedClipPath={selectedClipPath}
              onSelectClip={handleSelectClipFromMap}
              onOpenClip={onOpenClip}
              onViewportChange={setViewportBbox}
              onStyleChange={onMapStyleChange}
            />
          </section>
        </div>
      }
    />
  );
}
