'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { UiSession, WarmProgress, WarmRequest } from '../../src/appsession.js';
import { hasAltitude, settingsPatchOf } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { restyleSceneData } from '../../src/restyle.js';
import type { PickState } from '../lib/pickstate.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import { usePlayback } from '../hooks/usePlayback.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import { mapFrameSize } from '../lib/pipstyle.js';
import { ControlBar } from './ControlBar.js';
import { ExportModal } from './ExportModal.js';
import { OpenNotice } from './OpenNotice.js';
import { PlayerStage } from './PlayerStage.js';
import { SettingsPanel } from './SettingsPanel.js';
import { WarmHint } from './WarmHint.js';

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
    clearLoop,
    scrubTo,
    stepBy,
    togglePlay,
    handleScene,
    videoRef,
    scrubRef,
    timeRef,
  } = usePlayback(video, durationSec);
  const { modalOpen, settingsOpen, exportOpen, dismissible, dispatchDialog } = dialogs;
  const [mapIsMain, setMapIsMain] = useState(false);
  // The session's export sizes: the dialog reopens on the last committed ones.
  const [exportSizes, setExportSizes] = useState<{ width: number; height: number } | null>(null);
  const swap = useCallback(() => setMapIsMain((v) => !v), []);

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
  // settings, the view swap or the window size change what the map displays.
  useEffect(() => {
    if (!onWarmRetarget) return;
    const retarget = (): void =>
      onWarmRetarget({
        settings: settingsPatchOf(settings),
        frame: mapFrameSize(window.innerWidth, window.innerHeight, mapIsMain),
      });
    retarget();
    window.addEventListener('resize', retarget);
    return () => window.removeEventListener('resize', retarget);
  }, [onWarmRetarget, settings, mapIsMain]);

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
      closeOverlay: () => dispatchDialog({ type: 'close' }),
    },
    { modalOpen, fps: video.fps, frames: video.frames },
  );

  const maxFrame = Math.max(0, video.frames - 1);
  const opening = openState.kind === 'preparing';
  const openNotice =
    openState.kind === 'preparing' || openState.kind === 'error' ? (
      <OpenNotice state={openState} onDismiss={onDismissOpenState} />
    ) : null;
  const warmHint = warm ? <WarmHint progress={warm} /> : null;

  return (
    <>
      <PlayerStage
        video={video}
        sceneData={sceneData}
        mapIsMain={mapIsMain}
        videoRef={videoRef}
        onScene={handleScene}
        onPlayState={setPlaying}
        notice={
          openNotice || warmHint ? (
            <>
              {openNotice}
              {warmHint}
            </>
          ) : null
        }
      />
      <ControlBar
        dispatch={dispatch}
        opening={opening}
        ready={ready}
        playing={playing}
        speed={speed}
        loop={loop}
        fps={video.fps}
        durationSec={durationSec}
        maxFrame={maxFrame}
        scrubTo={scrubTo}
        scrubRef={scrubRef}
        timeRef={timeRef}
        onExport={() => dispatchDialog({ type: 'openExport' })}
        onSettings={() => dispatchDialog({ type: 'openSettings' })}
        onHelp={onHelp}
      />
      {settingsOpen ? (
        <SettingsPanel
          config={settings}
          hasAltitude={hasAltitude(preparedScene.alt)}
          onChange={onSettingsChange}
          onClose={() => dispatchDialog({ type: 'close' })}
        />
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
    </>
  );
}
