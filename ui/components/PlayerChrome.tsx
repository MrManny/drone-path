'use client';

import { useTranslation } from '../lib/i18n.js';
import { useCallback, useMemo, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { appearanceOf } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import { restyleSceneData } from 'drone-path-engine/restyle';
import { restyleMeta } from '../lib/restylemeta.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import { usePlayback } from '../hooks/usePlayback.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import { useTrackSave } from '../hooks/useTrackSave.js';
import type { StageLayout } from '../lib/layout.js';
import { frameRangeOf, resolveLoop } from '../lib/loop.js';
import { stepPinnedZoom } from '../lib/mapzoom.js';
import type { MenuItemId } from '../lib/menumodel.js';
import type { PickState } from '../lib/pickstate.js';
import { trackScope } from '../lib/tracksave.js';
import { ExportModal } from './ExportModal.js';
import { MenuBar } from './MenuBar.js';
import { OpenNotice } from './OpenNotice.js';
import { PlayerStage } from './PlayerStage.js';
import { TimelinePanel } from './TimelinePanel.js';
import { TrackSaveModal } from './TrackSaveModal.js';
import { TransportBar } from './TransportBar.js';
import { WorkspaceHeader } from './WorkspaceHeader.js';

export interface PlayerChromeProps {
  session: UiSession;
  settings: RenderConfig;
  onSettingsChange: (config: RenderConfig) => void;
  onOpen: () => void;
  onHelp: () => void;
  onExit: () => void;
  dialogs: Dialogs;
  openState?: PickState;
  onDismissOpenState?: () => void;
}

const IDLE_OPEN: PickState = { kind: 'idle' };

export function PlayerChrome({
  session,
  settings,
  onSettingsChange,
  onOpen,
  onHelp,
  onExit,
  dialogs,
  openState = IDLE_OPEN,
  onDismissOpenState,
}: PlayerChromeProps) {
  const t = useTranslation();
  const { video, durationSec } = session;
  const {
    ready,
    playing,
    setPlaying,
    speed,
    setSpeed,
    loop,
    setLoopPoint,
    setLoopFrame,
    clearLoop,
    scrubTo,
    stepBy,
    togglePlay,
    handleScene,
    videoRef,
    scrubRef,
    timeRef,
    playheadRef,
  } = usePlayback(video, durationSec);
  const { modalOpen, mapAppearanceOpen, exportOpen, trackSaveOpen, dismissible, dispatchDialog } =
    dialogs;
  const [layout, setLayout] = useState<StageLayout>('split');
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportSizes, setExportSizes] = useState<{ width: number; height: number } | null>(null);
  const swap = useCallback(() => setLayout((prev) => (prev === 'split' ? 'overlay' : 'split')), []);
  const toggleMapAppearance = useCallback(() => {
    dispatchDialog({ type: mapAppearanceOpen ? 'close' : 'openMapAppearance' });
  }, [mapAppearanceOpen, dispatchDialog]);

  const closeOverlay = useCallback(() => dispatchDialog({ type: 'close' }), [dispatchDialog]);

  const { style, zoom } = settings;
  const sceneData = useMemo(
    () => restyleSceneData(session.scene, appearanceOf(settings), restyleMeta(session)),
    [session, settings],
  );

  // One step pins the level the map shows as the fixed "Zoom" setting (#270).
  // A refusal reason is keyed to the level it was announced at, so it can
  // never speak for a level that arrived through another entry point (#271).
  const [zoomNotice, setZoomNotice] = useState<{ level: number; direction: 1 | -1 } | null>(null);
  const stepZoom = useCallback(
    (delta: 1 | -1) => {
      const pinned = stepPinnedZoom(sceneData.zoom, delta, style);
      if (pinned === null) {
        // A refused step says why instead of doing nothing silently (#271).
        // An identical repeat cannot re-announce; the button title keeps the
        // reason available either way.
        setZoomNotice({
          level: sceneData.zoom,
          direction: delta,
        });
        return;
      }
      setZoomNotice(null);
      onSettingsChange({ ...settings, zoom: pinned });
    },
    [settings, style, sceneData.zoom, onSettingsChange],
  );
  const zoomNoticeText =
    zoomNotice !== null && zoomNotice.level === sceneData.zoom
      ? zoomNotice.direction > 0 ? t('zoomStepper.alreadyAtMaximum') : t('zoomStepper.alreadyAtMinimum')
      : '';

  const dispatch = usePlayerHotkeys(
    {
      togglePlay,
      setSpeed,
      stepBy,
      scrubTo,
      setLoopPoint,
      clearLoop,
      swap,
      openRecording: onOpen,
      closeOverlay,
      zoomStep: stepZoom,
    },
    { modalOpen, menuOpen, fps: video.fps, frames: video.frames },
  );

  const maxFrame = Math.max(0, video.frames - 1);
  const opening = openState.kind === 'preparing';
  const openNotice =
    openState.kind === 'preparing' || openState.kind === 'error' ? (
      <OpenNotice state={openState} onDismiss={onDismissOpenState} />
    ) : null;

  const loopPoints = resolveLoop(loop, maxFrame);
  const trackRange = loopPoints ? frameRangeOf(loopPoints) : null;
  const scope = trackScope(trackRange, video.fps, durationSec, t);
  const {
    phase: trackSave,
    save: saveTrack,
    reveal: revealTrack,
  } = useTrackSave({ range: trackRange, scope, dispatchDialog });

  const menuActions: Record<MenuItemId, () => void> = {
    open: onOpen,
    exportVideo: () => dispatchDialog({ type: 'openExport' }),
    exportTelemetry: saveTrack,
    appSettings: () => dispatchDialog({ type: 'openSettings' }),
    settings: toggleMapAppearance,
    swap,
    documentation: onHelp,
    about: () => dispatchDialog({ type: 'openAbout' }),
    exit: onExit,
  };

  return (
    <div className="workspace">
      <MenuBar
        hasRecording
        opening={opening}
        modalOpen={modalOpen}
        itemTitles={{ exportTelemetry: t('playerChrome.telemetryScope', { scope }) }}
        onActivate={(item) => menuActions[item]()}
        onMenuOpenChange={setMenuOpen}
      />
      <WorkspaceHeader durationSec={durationSec} />
      <PlayerStage
        video={video}
        sceneData={sceneData}
        layout={layout}
        videoRef={videoRef}
        onScene={handleScene}
        onPlayState={setPlaying}
        notice={openNotice}
        zoomControls={{ zoom, style, onStep: stepZoom, notice: zoomNoticeText }}
      />
      <TransportBar
        dispatch={dispatch}
        ready={ready}
        playing={playing}
        speed={speed}
        fps={video.fps}
        durationSec={durationSec}
        timeRef={timeRef}
      />
      <TimelinePanel
        dispatch={dispatch}
        loop={loop}
        setLoopFrame={setLoopFrame}
        fps={video.fps}
        frames={video.frames}
        durationSec={durationSec}
        maxFrame={maxFrame}
        scrubTo={scrubTo}
        scrubRef={scrubRef}
        playheadRef={playheadRef}
        src={video.src}
      />
      {exportOpen ? (
        <ExportModal
          session={session}
          settings={settings}
          loop={loop}
          onClose={closeOverlay}
          dismissible={dismissible}
          dispatchDialog={dispatchDialog}
          onEncoderChange={(encode) => onSettingsChange({ ...settings, ...encode })}
          initialSizes={exportSizes}
          onSizesChange={setExportSizes}
        />
      ) : null}
      {trackSaveOpen && trackSave ? (
        <TrackSaveModal
          phase={trackSave}
          dismissible={dismissible}
          onReveal={revealTrack}
          onClose={closeOverlay}
        />
      ) : null}
    </div>
  );
}
