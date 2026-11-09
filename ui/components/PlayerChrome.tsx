'use client';

import { useCallback, useMemo, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { hasAltitude } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { errorMessage } from '../../src/errors.js';
import { restyleSceneData } from '../../src/restyle.js';
import { restyleMeta } from '../lib/restylemeta.js';
import { appBridge } from '../lib/backend.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import { useMapAppearance } from '../hooks/useMapAppearance.js';
import { usePlayback } from '../hooks/usePlayback.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import type { StageLayout } from '../lib/layout.js';
import { engagedLoop } from '../lib/loop.js';
import { closeOverlayTarget } from '../lib/overlayrouting.js';
import type { PickState } from '../lib/pickstate.js';
import type { TelemetrySavePhase } from '../lib/telemetrysave.js';
import { telemetryScope, telemetrySaveFlow } from '../lib/telemetrysave.js';
import { ExportHost } from './ExportHost.js';
import { OpenNotice } from './OpenNotice.js';
import { PlayerStage } from './PlayerStage.js';
import { Popover } from './Popover.js';
import { SettingsPanel } from './SettingsPanel.js';
import { StatusBar } from './StatusBar.js';
import { TelemetrySaveModal } from './TelemetrySaveModal.js';
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
  const { modalOpen, exportOpen, telemetrySaveOpen, dismissible, dispatchDialog } = dialogs;
  // Side-by-side panes are the default: dedicated, simultaneously visible
  // video and map panes. Swap view flips to the overlay layout, where the map
  // is a corner card over the footage for immersive review.
  const [layout, setLayout] = useState<StageLayout>('split');
  // The Save telemetry JSON dialog's phase: the write in flight, then its
  // outcome. The dialog opens only once the native save dialog confirmed.
  const [telemetrySave, setTelemetrySave] = useState<TelemetrySavePhase | null>(null);
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
  const { style, view, zoom, zoomOut, introSec, outroSec, hud } = settings;
  const sceneData = useMemo(
    () =>
      restyleSceneData(
        session.scene,
        { style, view, zoom, zoomOut, introSec, outroSec, hud },
        restyleMeta(session),
      ),
    [session, style, view, zoom, zoomOut, introSec, outroSec, hud],
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

  // The telemetry save follows the loop points automatically: an engaged loop
  // saves its In-Out segment — the same frames the segment export renders —
  // and without one the whole recording.
  const loopPoints = engagedLoop(loop);
  const telemetryRange = loopPoints
    ? { start: loopPoints.in, end: loopPoints.out }
    : null;
  const scope = telemetryScope(telemetryRange, video.fps, durationSec);

  const saveTelemetryJson = (): void => {
    void (async () => {
      let opened = false;
      const event = await telemetrySaveFlow(
        {
          pickTelemetryOutput: () => appBridge().pickTelemetryOutput(),
          saveTelemetryJson: (request) => appBridge().saveTelemetryJson(request),
        },
        telemetryRange,
        () => {
          opened = true;
          setTelemetrySave({ kind: 'saving' });
          dispatchDialog({ type: 'openTelemetrySave' });
        },
      );
      // A canceled save dialog starts nothing and stays silent; every other
      // outcome surfaces in the compact dialog, pick failures included.
      if (event.type === 'canceled') return;
      if (!opened) dispatchDialog({ type: 'openTelemetrySave' });
      setTelemetrySave(
        event.type === 'saved'
          ? { kind: 'done', path: event.path }
          : { kind: 'error', message: event.message },
      );
    })();
  };

  // The done dialog's reveal reuses the export reveal handler; its failure
  // surfaces above the done content instead of closing it.
  const revealTelemetry = (): void => {
    const path = telemetrySave?.kind === 'done' ? telemetrySave.path : null;
    if (path === null) return;
    void (async () => {
      try {
        const ack = await appBridge().revealExportOutput({ out: path });
        setTelemetrySave(
          ack.ok
            ? { kind: 'done', path }
            : { kind: 'done', path, error: ack.error ?? 'the file could not be revealed' },
        );
      } catch (e) {
        setTelemetrySave({ kind: 'done', path, error: errorMessage(e) });
      }
    })();
  };

  return (
    <div className="workspace">
      <WorkspaceHeader
        durationSec={durationSec}
        opening={opening}
        telemetryScope={scope}
        onOpen={onOpen}
        onExport={() => dispatchDialog({ type: 'openExport' })}
        onTelemetrySave={saveTelemetryJson}
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
      {telemetrySaveOpen && telemetrySave ? (
        <TelemetrySaveModal
          scope={scope}
          phase={telemetrySave}
          onReveal={revealTelemetry}
          onClose={() => dispatchDialog({ type: 'close' })}
        />
      ) : null}
    </div>
  );
}
