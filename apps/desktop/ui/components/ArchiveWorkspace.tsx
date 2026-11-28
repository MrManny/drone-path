'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Download,
  Folder,
  FolderPlus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';

import type { MapStyle } from 'drone-path-engine/config';
import { leafName } from '../../shared/errors.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import type { ArchiveWorkspaceState } from '../hooks/useArchiveWorkspace.js';
import { archiveSidebar } from '../lib/archivesidebar.js';
import type { ArchiveSort } from '../lib/archivesidebar.js';
import { useTranslation } from '../lib/i18n.js';
import type { PickState } from '../lib/pickstate.js';
import { ArchiveExportModal } from './ArchiveExportModal.js';
import { ArchiveFlightCard } from './ArchiveFlightCard.js';
import { ArchiveFilterRail } from './ArchiveFilterRail.js';
import { ArchiveMap } from './ArchiveMap.js';
import { DialogShell } from './DialogShell.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';
import { OpenNotice } from './OpenNotice.js';
import type { WorkspaceMode } from './WorkspaceHeader.js';
import { WorkspaceShell } from './WorkspaceShell.js';

interface ArchiveWorkspaceProps {
  archive: ArchiveWorkspaceState;
  locale: string;
  hasRecording: boolean;
  openState: PickState;
  mapStyle?: MapStyle;
  onMapStyleChange?: (style: MapStyle) => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onOpenClip: (path: string, seekSec?: number) => void;
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
  locale,
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
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ArchiveSort>('oldest');
  const [confirmPruneOpen, setConfirmPruneOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const {
    roots,
    offlineRoots,
    flights,
    availableFlightIds,
    totalCount,
    offlineCount,
    scanning,
    pruning,
    lastPrunedCount,
    scanProgress,
    error,
    mapView,
    selectedClipPath,
    filtersOpen,
    pointHits,
    pointQueryCoord,
    pointQueryLoading,
    pointQueryActive,
    filters,
    activeFilterCount,
    activeQueryFilters,
    setViewportBbox,
    setDetailViewportBbox,
    setMapView,
    setSelectedClipPath,
    setFiltersOpen,
    togglePointQuery,
    queryAtPoint,
    clearPointQuery,
    setFilters,
    clearFilters,
    removeFolder,
    rescan,
    cancelScan,
    revealClip,
    pruneOffline,
    dismissPruneStatus,
    dismissError,
  } = archive;

  const listRef = useRef<HTMLDivElement>(null);
  const [expandedFlights, setExpandedFlights] = useState<ReadonlySet<string>>(() => new Set(
    flights.filter((flight) => flight.clips.some(({ path }) => path === selectedClipPath))
      .map(({ flightId }) => flightId),
  ));
  const [scrollTarget, setScrollTarget] = useState<{ path: string } | null>(null);
  const opening = openState.kind === 'preparing';
  const { dates, matchCount } = useMemo(() => archiveSidebar(flights, search, sort), [flights, search, sort]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }), [locale]);

  const handleSelectClipFromMap = useCallback(
    (clipPath: string) => {
      setSelectedClipPath(clipPath);
      const flight = flights.find(({ clips }) => clips.some(({ path }) => path === clipPath));
      if (flight) {
        setExpandedFlights((previous) => new Set([...previous, flight.flightId]));
        setScrollTarget({ path: clipPath });
      }
    },
    [flights, setSelectedClipPath],
  );

  useLayoutEffect(() => {
    if (!scrollTarget) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-archive-clip]');
    const button = buttons && Array.from(buttons).find(({ dataset }) => dataset.archiveClip === scrollTarget.path);
    button?.scrollIntoView?.({ block: 'nearest' });
  }, [scrollTarget]);

  const handleClipListKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '.archive-flight-button:not(:disabled), .archive-clip-row:not(:disabled)',
    )];
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
            <section className="archive-clips" aria-label={t('workspaceHeader.archiveMode')}>
              <div className="archive-clips-summary">
                <div className="archive-pane-header">
                  <div>
                    <h2 className="archive-sidebar-title">{t('workspaceHeader.archiveMode')}</h2>
                    <div className="archive-clips-counts" role="status">
                      <span className="readout">
                        {search.trim()
                          ? t('archiveWorkspace.searchCount', { count: matchCount, total: totalCount })
                          : t('archiveWorkspace.recordingCount', { count: totalCount })}
                      </span>
                      {offlineCount > 0 ? (
                        <span className="hint">{t('archiveWorkspace.offlineCount', { count: offlineCount })}</span>
                      ) : null}
                    </div>
                  </div>
                  <button type="button" aria-haspopup="dialog" onClick={() => setFoldersOpen(true)}>
                    <Folder aria-hidden="true" />
                    {t('archiveWorkspace.folders', { count: roots.length })}
                  </button>
                </div>
                <input
                  type="search"
                  aria-label={t('archiveWorkspace.searchFilenames')}
                  placeholder={t('archiveWorkspace.searchFilenames')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="archive-clips-actions">
                  <button
                    type="button"
                    className="archive-filter-toggle"
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen((open) => !open)}
                  >
                    <SlidersHorizontal aria-hidden="true" />
                    <span>{t('archiveFilters.toggle')}</span>
                    {activeFilterCount > 0 ? (
                      <span className="archive-filter-count">{activeFilterCount}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="archive-export-trigger"
                    disabled={totalCount === 0 || scanning}
                    onClick={() => setExportModalOpen(true)}
                  >
                    <Download aria-hidden="true" />
                    <span>{t('archiveWorkspace.exportArchive')}</span>
                  </button>
                  <select aria-label={t('archiveWorkspace.sortFlights')} value={sort}
                    onChange={(event) => setSort(event.target.value === 'newest' ? 'newest' : 'oldest')}>
                    <option value="oldest">{t('archiveWorkspace.oldestFirst')}</option>
                    <option value="newest">{t('archiveWorkspace.newestFirst')}</option>
                  </select>
                </div>
              </div>
              <div className="archive-list-scroll" ref={listRef} onKeyDown={handleClipListKeyDown}>
                {openState.kind === 'preparing' || openState.kind === 'error' ? (
                  <OpenNotice state={openState} onDismiss={onDismissOpenState} />
                ) : null}
                {error && !foldersOpen ? <ErrorNotice error={error} onDismiss={dismissError} /> : null}
                {lastPrunedCount !== null && lastPrunedCount > 0 && !foldersOpen ? (
                  <Notice tone="info" onDismiss={dismissPruneStatus}>
                    {t('archiveWorkspace.prunedOffline', { count: lastPrunedCount })}
                  </Notice>
                ) : null}
                {filtersOpen ? (
                  <ArchiveFilterRail
                    filters={filters}
                    roots={roots}
                    flightIds={availableFlightIds}
                    activeCount={activeFilterCount}
                    onChange={setFilters}
                    onClear={clearFilters}
                  />
                ) : null}
                {dates.length === 0 ? (
                  <div className="archive-empty">
                    {roots.length === 0 ? (
                      <>
                        <p>{t('archiveWorkspace.emptyPrompt')}</p>
                        <button type="button" className="primary" onClick={onOpenFolder}>
                          {t('archiveWorkspace.addFolder')}
                        </button>
                      </>
                    ) : (
                      <p className="hint">{search.trim()
                        ? t('archiveWorkspace.noFilenameMatches')
                        : t('archiveWorkspace.noRecordings')}</p>
                    )}
                  </div>
                ) : (
                  <div className="archive-flights">
                    {dates.map(([day, items]) => (
                      <section key={day ?? 'undated'} className="archive-date-group">
                        <h3 className="archive-date-heading">
                          {day ? dateFormat.format(new Date(day)) : t('archiveWorkspace.undated')}
                        </h3>
                        <ul className="archive-flight-list">
                          {items.map(({ flight, index, matches }) => (
                            <ArchiveFlightCard key={flight.flightId} flight={flight} index={index}
                              matches={matches} expanded={expandedFlights.has(flight.flightId)}
                              onToggle={() => setExpandedFlights((previous) => {
                                const next = new Set(previous);
                                if (!next.delete(flight.flightId)) next.add(flight.flightId);
                                return next;
                              })}
                              opening={opening} selectedClipPath={selectedClipPath} onSelectClip={setSelectedClipPath}
                              onOpenClip={onOpenClip} onRevealClip={(path) => void revealClip(path)} />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </div>
              <footer className="archive-index-status hint">
                {roots.length > 0 ? (
                  <span title={roots.join('\n')}>{roots.length === 1
                    ? (leafName(roots[0]) || roots[0])
                    : t('archiveWorkspace.folderSummaryMulti', {
                      count: roots.length, name: leafName(roots[0]) || roots[0], rest: roots.length - 1,
                    })}
                  </span>
                ) : null}
                <span role="status">{scanStatusText ?? (roots.length > 0
                  ? t('archiveWorkspace.indexStatus')
                  : t('archiveWorkspace.noFoldersStatus'))}</span>
              </footer>
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
              onDetailViewportChange={setDetailViewportBbox}
              initialMapView={mapView}
              onMapViewChange={setMapView}
              onStyleChange={onMapStyleChange}
              pointQueryActive={pointQueryActive}
              onTogglePointQuery={togglePointQuery}
              pointQueryCoord={pointQueryCoord}
              pointHits={pointHits}
              pointQueryLoading={pointQueryLoading}
              onPointQuery={(point, radiusM) => void queryAtPoint(point, radiusM)}
              onClearPointQuery={clearPointQuery}
            />
          </section>
          {foldersOpen ? (
            <DialogShell
              title={confirmPruneOpen
                ? t('archiveWorkspace.pruneOfflineTitle')
                : t('archiveWorkspace.watchedFolders')}
              focusKey={confirmPruneOpen ? 'prune' : 'folders'}
              blockedReason={pruning ? t('archiveWorkspace.pruningOffline') : undefined}
              closeOnBackdrop={!pruning}
              onClose={() => {
                if (pruning) return;
                if (confirmPruneOpen) setConfirmPruneOpen(false);
                else setFoldersOpen(false);
              }}
            >
              {confirmPruneOpen ? (
                <>
                  {error ? <ErrorNotice error={error} onDismiss={dismissError} /> : null}
                  <Notice tone="warning">
                    {t('archiveWorkspace.pruneOfflineConfirm', { count: offlineCount })}
                  </Notice>
                  <div className="dialog-actions">
                    <button type="button" data-phase-focus disabled={pruning} onClick={() => setConfirmPruneOpen(false)}>
                      {t('archiveWorkspace.pruneOfflineCancel')}
                    </button>
                    <button type="button" className="dialog-primary" disabled={pruning || offlineCount === 0}
                      onClick={() => void pruneOffline().then((removed) => {
                        if (removed !== null) setConfirmPruneOpen(false);
                      })}>
                      {pruning ? t('archiveWorkspace.pruningOffline') : t('archiveWorkspace.pruneOfflineConfirmAction')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {error ? <ErrorNotice error={error} onDismiss={dismissError} /> : null}
                  {lastPrunedCount !== null && lastPrunedCount > 0 ? (
                    <Notice tone="info" onDismiss={dismissPruneStatus}>
                      {t('archiveWorkspace.prunedOffline', { count: lastPrunedCount })}
                    </Notice>
                  ) : null}
                  {roots.length === 0 ? (
                    <p className="hint">{t('archiveWorkspace.noFolders')}</p>
                  ) : (
                    <ul className="archive-folder-list">
                      {roots.map((root) => {
                        const name = leafName(root) || root;
                        const offline = offlineRoots.has(root);
                        return (
                          <li key={root} className={`archive-folder-row${offline ? ' archive-folder-row-offline' : ''}`}>
                            <div className="archive-folder-meta">
                              <div className="archive-folder-heading">
                                <span className="archive-folder-name">{name}</span>
                                {offline ? <span className="archive-badge archive-badge-offline">
                                  {t('archiveWorkspace.offlineBadge')}
                                </span> : null}
                              </div>
                              <span className="archive-folder-path hint" title={root}>{root}</span>
                            </div>
                            <button type="button" className="archive-folder-remove"
                              aria-label={t('archiveWorkspace.removeFolderLabel', { name })}
                              onClick={() => void removeFolder(root)}>
                              <Trash2 aria-hidden="true" />
                              {t('archiveWorkspace.removeFolder')}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {scanStatusText ? <p className="archive-scan-status hint" role="status">{scanStatusText}</p> : null}
                  <div className="dialog-actions archive-folder-actions">
                    {roots.length > 0 ? (
                      <button type="button" data-phase-focus disabled={offlineCount === 0 || scanning || pruning} onClick={() => setConfirmPruneOpen(true)}>
                        <Trash2 aria-hidden="true" />
                        {t('archiveWorkspace.pruneOffline')}
                      </button>
                    ) : null}
                    {roots.length > 0 ? (
                      <button type="button" onClick={() => void (scanning ? cancelScan() : rescan())}>
                        {scanning ? <X aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                        {scanning ? t('archiveWorkspace.cancelScan') : t('archiveWorkspace.rescan')}
                      </button>
                    ) : null}
                    <button type="button" className="dialog-primary" onClick={onOpenFolder}>
                      <FolderPlus aria-hidden="true" />
                      {t('archiveWorkspace.addFolder')}
                    </button>
                  </div>
                </>
              )}
            </DialogShell>
          ) : null}
          {exportModalOpen ? (
            <ArchiveExportModal
              filters={activeQueryFilters}
              hasActiveFilters={activeFilterCount > 0}
              onClose={() => setExportModalOpen(false)}
            />
          ) : null}
        </div>
      }
    />
  );
}
