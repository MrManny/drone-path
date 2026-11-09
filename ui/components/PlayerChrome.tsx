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
import { MenuBar } from './MenuBar.js';
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
  const [layout, setLayout] = useState<StageLayout>('split');
  const [menuOpen, setMenuOpen] = useState(false);
  const [telemetrySave, setTelemetrySave] = useState<TelemetrySavePhase | null>(null);
  const swap = useCallback(() => setLayout((prev) => (prev === 'split' ? 'overlay' : 'split')), []);
  const {
    open: mapAppearanceOpen,
    toggle: toggleMapAppearance,
    close: closeMapAppearance,
    triggerRef: appearanceButtonRef,
  } = useMapAppearance();

  const closeOverlay = useCallback(() => {
    const target = closeOverlayTarget({ modalOpen, popoverOpen: mapAppearanceOpen });
    if (target === 'modal') dispatchDialog({ type: 'close' });
    else if (target === 'popover') closeMapAppearance();
  }, [modalOpen, mapAppearanceOpen, dispatchDialog, closeMapAppearance]);

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
    { modalOpen, popoverOpen: mapAppearanceOpen, menuOpen, fps: video.fps, frames: video.frames },
  );

  const maxFrame = Math.max(0, video.frames - 1);
  const opening = openState.kind === 'preparing';
  const openNotice =
    openState.kind === 'preparing' || openState.kind === 'error' ? (
      <OpenNotice state={openState} onDismiss={onDismissOpenState} />
    ) : null;

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
          dispatchDialog({ type: 'telemetrySaveStarted' });
        },
      );
      if (event.type === 'canceled') return;
      if (opened) dispatchDialog({ type: 'telemetrySaveFinished' });
      else dispatchDialog({ type: 'openTelemetrySave' });
      setTelemetrySave(
        event.type === 'saved'
          ? { kind: 'done', path: event.path, scope }
          : { kind: 'error', message: event.message },
      );
    })();
  };

  const revealTelemetry = (): void => {
    const done = telemetrySave?.kind === 'done' ? telemetrySave : null;
    if (done === null) return;
    void (async () => {
      try {
        const ack = await appBridge().revealExportOutput({ out: done.path });
        setTelemetrySave(
          ack.ok
            ? done
            : { ...done, error: ack.error ?? 'the file could not be revealed' },
        );
      } catch (e) {
        setTelemetrySave({ ...done, error: errorMessage(e) });
      }
    })();
  };

  return (
    <div className="workspace">
      <MenuBar
        hasRecording
        opening={opening}
        modalOpen={modalOpen}
        itemTitles={{ exportTelemetry: `Exports telemetry for the ${scope}` }}
        onOpen={onOpen}
        onExportVideo={() => dispatchDialog({ type: 'openExport' })}
        onExportTelemetry={saveTelemetryJson}
        onSettings={toggleMapAppearance}
        onSwap={swap}
        onDocumentation={onHelp}
        onAbout={() => dispatchDialog({ type: 'openAbout' })}
        onExit={onExit}
        onMenuOpenChange={setMenuOpen}
        barRef={appearanceButtonRef}
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
      <StatusBar hasTelemetry={session.scene.lat.length > 0} />
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
          phase={telemetrySave}
          dismissible={dismissible}
          onReveal={revealTelemetry}
          onClose={() => dispatchDialog({ type: 'close' })}
        />
      ) : null}
    </div>
  );
}
