'use client';

import { useCallback, useMemo, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { hasAltitude } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { restyleSceneData } from '../../src/restyle.js';
import { restyleMeta } from '../lib/restylemeta.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import { useMapAppearance } from '../hooks/useMapAppearance.js';
import { usePlayback } from '../hooks/usePlayback.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import type { StageLayout } from '../lib/layout.js';
import { closeOverlayTarget } from '../lib/overlayrouting.js';
import type { PickState } from '../lib/pickstate.js';
import { ExportHost } from './ExportHost.js';
import { OpenNotice } from './OpenNotice.js';
import { PlayerStage } from './PlayerStage.js';
import { Popover } from './Popover.js';
import { SettingsPanel } from './SettingsPanel.js';
import { StatusBar } from './StatusBar.js';
import { TimelinePanel } from './TimelinePanel.js';
import { TransportBar } from './TransportBar.js';
import { WorkspaceHeader } from './WorkspaceHeader.js';

export interface PlayerChromeProps {
  session: UiSession;
  settings: RenderConfig;
  onSettingsChange: (config: RenderConfig) => void;
  onOpen: () => void;
  onHelp: () => void;
  /** The app's one dialog machine, shared with the update prompt at page level. */
  dialogs: Dialogs;
  /** The Open flow: only preparing and failures show over the player. */
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
  dialogs,
  openState = IDLE_OPEN,
  onDismissOpenState,
}: PlayerChromeProps) {
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
  const { modalOpen, exportOpen, dismissible, dispatchDialog } = dialogs;
  // Side-by-side panes are the default: dedicated, simultaneously visible
  // video and map panes. Swap view flips to the overlay layout, where the map
  // is a corner card over the footage for immersive review.
  const [layout, setLayout] = useState<StageLayout>('split');
  const swap = useCallback(() => setLayout((prev) => (prev === 'split' ? 'overlay' : 'split')), []);
  const {
    open: mapAppearanceOpen,
    toggle: toggleMapAppearance,
    close: closeMapAppearance,
    triggerRef: appearanceButtonRef,
  } = useMapAppearance();

  // Escape closes the topmost overlay: a dialog above the popover above the
  // loop clear; dialogs keep their own rule through the dialog machine.
  const closeOverlay = useCallback(() => {
    const target = closeOverlayTarget({ modalOpen, popoverOpen: mapAppearanceOpen });
    if (target === 'modal') dispatchDialog({ type: 'close' });
    else if (target === 'popover') closeMapAppearance();
  }, [modalOpen, mapAppearanceOpen, dispatchDialog, closeMapAppearance]);

  // One settings -> scene mapping for the preview and the export: the same
  // pure planners the pipeline runs, keyed on the fields the plan reads so
  // encoder edits never re-plan the scene.
  const { style, trailColor, view, zoom, zoomOut, introSec, outroSec, hud } = settings;
  const sceneData = useMemo(
    () =>
      restyleSceneData(
        session.scene,
        { style, trailColor, view, zoom, zoomOut, introSec, outroSec, hud },
        restyleMeta(session),
      ),
    [session, style, trailColor, view, zoom, zoomOut, introSec, outroSec, hud],
  );

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
    },
    { modalOpen, popoverOpen: mapAppearanceOpen, fps: video.fps, frames: video.frames },
  );

  const maxFrame = Math.max(0, video.frames - 1);
  const opening = openState.kind === 'preparing';
  const openNotice =
    openState.kind === 'preparing' || openState.kind === 'error' ? (
      <OpenNotice state={openState} onDismiss={onDismissOpenState} />
    ) : null;

  return (
    <div className="workspace">
      <WorkspaceHeader
        durationSec={durationSec}
        opening={opening}
        onOpen={onOpen}
        onExport={() => dispatchDialog({ type: 'openExport' })}
      />
      <PlayerStage
        video={video}
        sceneData={sceneData}
        layout={layout}
        videoRef={videoRef}
        onScene={handleScene}
        onPlayState={setPlaying}
        notice={openNotice}
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
      <StatusBar
        hasTelemetry={session.scene.lat.length > 0}
        onMapSettings={toggleMapAppearance}
        mapSettingsOpen={mapAppearanceOpen}
        settingsButtonRef={appearanceButtonRef}
        onSwap={swap}
        onHelp={onHelp}
      />
      {mapAppearanceOpen ? (
        <Popover label="Map appearance" triggerRef={appearanceButtonRef} onClose={closeMapAppearance}>
          <SettingsPanel
            config={settings}
            hasAltitude={hasAltitude(session.scene.alt)}
            onChange={onSettingsChange}
          />
        </Popover>
      ) : null}
      <ExportHost
        session={session}
        settings={settings}
        loop={loop}
        open={exportOpen}
        dismissible={dismissible}
        onClose={() => dispatchDialog({ type: 'close' })}
        onRunEvent={dispatchDialog}
        onSettingsChange={onSettingsChange}
      />
    </div>
  );
}
