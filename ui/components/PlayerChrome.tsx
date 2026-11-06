'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { UiSession, WarmProgress, WarmRequest } from '../../src/appsession.js';
import { hasAltitude, settingsPatchOf } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { restyleSceneData } from '../../src/restyle.js';
import type { PickState } from '../lib/pickstate.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import { usePlayback } from '../hooks/usePlayback.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import type { StageLayout } from '../lib/layout.js';
import { mapFrameSize } from '../lib/layout.js';
import { ExportModal } from './ExportModal.js';
import { OpenNotice } from './OpenNotice.js';
import { PlayerStage } from './PlayerStage.js';
import { Popover } from './Popover.js';
import { SettingsPanel } from './SettingsPanel.js';
import { StatusBar } from './StatusBar.js';
import { TimelinePanel } from './TimelinePanel.js';
import { TransportBar } from './TransportBar.js';
import { WarmHint } from './WarmHint.js';
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
  /** The background pre-warm's running count, for the warm hint. */
  warm?: WarmProgress | null;
  /** Re-targets the background pre-warm onto the tiles the map now shows. */
  onWarmRetarget?: (request: WarmRequest) => void;
}

const IDLE_OPEN: PickState = { kind: 'idle' };

// The synchronized video-and-map review workspace: header, preview area with
// the two stage layouts, transport, timeline and status bar, with the map
// appearance popover beside the app's dialogs.
export function PlayerChrome({
  session,
  settings,
  onSettingsChange,
  onOpen,
  onHelp,
  dialogs,
  openState = IDLE_OPEN,
  onDismissOpenState,
  warm = null,
  onWarmRetarget,
}: PlayerChromeProps) {
  const { scene: preparedScene, video, tileBase, bbox, durationSec } = session;
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
    positionRef,
    statusTimeRef,
    playheadRef,
  } = usePlayback(video, durationSec);
  const { modalOpen, exportOpen, dismissible, dispatchDialog } = dialogs;
  // Side-by-side panes are the default: dedicated, simultaneously visible
  // video and map panes. Swap view flips to the overlay layout, where the map
  // is a corner card over the footage for immersive review.
  const [layout, setLayout] = useState<StageLayout>('split');
  const [mapAppearanceOpen, setMapAppearanceOpen] = useState(false);
  const appearanceButtonRef = useRef<HTMLButtonElement>(null);
  // The session's export sizes: the dialog reopens on the last committed ones.
  const [exportSizes, setExportSizes] = useState<{ width: number; height: number } | null>(null);
  const swap = useCallback(() => setLayout((prev) => (prev === 'split' ? 'overlay' : 'split')), []);
  const closeMapAppearance = useCallback(() => {
    setMapAppearanceOpen(false);
    appearanceButtonRef.current?.focus();
  }, []);

  // Escape closes the popover while it is open and clears the loop otherwise;
  // dialogs keep their own rule through the dialog machine.
  const closeOverlay = useCallback(() => {
    if (mapAppearanceOpen) closeMapAppearance();
    else dispatchDialog({ type: 'close' });
  }, [mapAppearanceOpen, closeMapAppearance, dispatchDialog]);

  // One settings -> scene mapping for the preview and the export: the same
  // pure planners the pipeline runs.
  const sceneData = useMemo(
    () =>
      restyleSceneData(preparedScene, settings, {
        fps: video.fps,
        frames: video.frames,
        tileBase,
        bbox,
      }),
    [preparedScene, settings, video.fps, video.frames, tileBase, bbox],
  );

  // The background pre-warm follows the map on screen: it pivots when
  // settings, the stage layout or the window size change what the map displays.
  useEffect(() => {
    if (!onWarmRetarget) return;
    const retarget = (): void =>
      onWarmRetarget({
        settings: settingsPatchOf(settings),
        frame: mapFrameSize(window.innerWidth, window.innerHeight, layout),
      });
    retarget();
    window.addEventListener('resize', retarget);
    return () => window.removeEventListener('resize', retarget);
  }, [onWarmRetarget, settings, layout]);

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
  const warmHint = warm ? <WarmHint progress={warm} /> : null;

  return (
    <div className="workspace">
      <WorkspaceHeader
        durationSec={durationSec}
        ready={ready}
        opening={opening}
        onOpen={onOpen}
        onExport={() => dispatchDialog({ type: 'openExport' })}
        onMapAppearance={() =>
          mapAppearanceOpen ? closeMapAppearance() : setMapAppearanceOpen(true)
        }
        mapAppearanceOpen={mapAppearanceOpen}
        appearanceButtonRef={appearanceButtonRef}
      />
      <PlayerStage
        video={video}
        sceneData={sceneData}
        settings={settings}
        durationSec={durationSec}
        layout={layout}
        playing={playing}
        statusTimeRef={statusTimeRef}
        positionRef={positionRef}
        videoRef={videoRef}
        onScene={handleScene}
        onPlayState={setPlaying}
        onSwap={swap}
        notice={
          openNotice || warmHint ? (
            <>
              {openNotice}
              {warmHint}
            </>
          ) : null
        }
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
        ready={ready}
        hasTelemetry={preparedScene.lat.length > 0}
        durationSec={durationSec}
        onHelp={onHelp}
      />
      {mapAppearanceOpen ? (
        <Popover label="Map appearance" onClose={closeMapAppearance}>
          <SettingsPanel
            config={settings}
            hasAltitude={hasAltitude(preparedScene.alt)}
            onChange={onSettingsChange}
          />
        </Popover>
      ) : null}
      {exportOpen ? (
        <ExportModal
          session={session}
          settings={settings}
          loop={loop}
          onClose={() => dispatchDialog({ type: 'close' })}
          dismissible={dismissible}
          onRunEvent={dispatchDialog}
          onEncoderChange={(encode) => onSettingsChange({ ...settings, ...encode })}
          initialSizes={exportSizes}
          onSizesChange={setExportSizes}
        />
      ) : null}
    </div>
  );
}
