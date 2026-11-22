'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { FrameRange } from 'drone-path-core/frame-range';
import type { RenderConfig } from 'drone-path-engine/config';
import type { UiSession } from '../../src/appsession.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import { usePlayback } from '../hooks/usePlayback.js';
import { useTranslation } from '../lib/i18n.js';
import type { StageLayout } from '../lib/layout.js';
import type { LoopState } from '../lib/loop.js';
import { frameRangeOf, resolveLoop } from '../lib/loop.js';
import { stepPinnedZoom } from '../lib/mapzoom.js';
import type { PickState } from '../lib/pickstate.js';
import { restyleSession } from '../lib/restylemeta.js';
import { trackScope } from '../lib/tracksave.js';
import { OpenNotice } from './OpenNotice.js';
import { PlayerStage } from './PlayerStage.js';
import { WorkspaceShell } from './WorkspaceShell.js';

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
  loopControl?: [LoopState, Dispatch<SetStateAction<LoopState>>];
  onExportVideo?: () => void;
  onExportTelemetry?: (range: FrameRange | null, scope: string) => void;
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
  loopControl,
  onExportVideo,
  onExportTelemetry,
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
  } = usePlayback(video, durationSec, loopControl);
  const { dispatchDialog } = dialogs;
  const [layout, setLayout] = useState<StageLayout>('split');
  const swap = useCallback(() => setLayout((prev) => (prev === 'split' ? 'overlay' : 'split')), []);

  const { style, zoom } = settings;
  const sceneData = useMemo(() => restyleSession(session, settings), [session, settings]);

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

  const maxFrame = Math.max(0, video.frames - 1);
  const opening = openState.kind === 'preparing';
  const openNotice =
    openState.kind === 'preparing' || openState.kind === 'error' ? (
      <OpenNotice state={openState} onDismiss={onDismissOpenState} />
    ) : null;

  const loopPoints = resolveLoop(loop, maxFrame);
  const trackRange = loopPoints ? frameRangeOf(loopPoints) : null;
  const scope = trackScope(trackRange, video.fps, durationSec, t);

  return (
    <WorkspaceShell
      hasRecording
      opening={opening}
      durationSec={durationSec}
      dialogs={dialogs}
      onOpen={onOpen}
      onHelp={onHelp}
      onExit={onExit}
      itemTitles={{ exportTelemetry: t('playerChrome.telemetryScope', { scope }) }}
      extraActions={{
        exportVideo: onExportVideo ?? (() => dispatchDialog({ type: 'openExport' })),
        exportTelemetry: () => onExportTelemetry?.(trackRange, scope),
        swap,
      }}
      hotkeyHandlers={{
        togglePlay,
        setSpeed,
        stepBy,
        scrubTo,
        setLoopPoint,
        clearLoop,
        swap,
        zoomStep: stepZoom,
      }}
      hotkeyTiming={{ fps: video.fps, frames: video.frames }}
      stage={
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
      }
      transport={{ ready, playing, speed, fps: video.fps, durationSec, timeRef }}
      timeline={{
        loop,
        setLoopFrame,
        fps: video.fps,
        frames: video.frames,
        durationSec,
        maxFrame,
        scrubTo,
        scrubRef,
        playheadRef,
        src: video.src,
      }}
    />
  );
}
