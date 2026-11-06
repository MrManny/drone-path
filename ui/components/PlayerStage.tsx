'use client';

import type { ReactNode, RefObject } from 'react';

import type { PageVideo } from '../../src/appsession.js';
import type { RenderConfig } from '../../src/config.js';
import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { StageLayout } from '../lib/layout.js';
import { formatTimeReadout } from '../lib/frametime.js';
import { SwapIcon } from '../icons/SwapIcon.js';
import { MapCard } from './MapCard.js';

export interface PlayerStageProps {
  video: PageVideo;
  sceneData: SceneData;
  settings: Pick<RenderConfig, 'style' | 'view'>;
  durationSec: number;
  layout: StageLayout;
  playing: boolean;
  /** The preview strip's position word, updated imperatively. */
  statusTimeRef: RefObject<HTMLSpanElement | null>;
  /** The map card's "Current position" readout, updated imperatively. */
  positionRef: RefObject<HTMLSpanElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  onScene: (scene: Scene) => void;
  onPlayState: (playing: boolean) => void;
  onSwap: () => void;
  /** The open-flow notices and the warm hint, centered over the stage. */
  notice: ReactNode;
}

export function PlayerStage({
  video,
  sceneData,
  settings,
  durationSec,
  layout,
  playing,
  statusTimeRef,
  positionRef,
  videoRef,
  onScene,
  onPlayState,
  onSwap,
  notice,
}: PlayerStageProps) {
  return (
    <div className="preview">
      <div className="preview-strip">
        <div className="preview-strip-group">
          <span className="preview-title">Preview</span>
          <span className="preview-note">Video + map</span>
        </div>
        <div className="preview-strip-group">
          <span className="preview-state">
            {playing ? 'Playing at ' : 'Paused at '}
            <span ref={statusTimeRef}>0:00</span>
          </span>
          <button type="button" onClick={onSwap}>
            <SwapIcon />
            Swap view
          </button>
        </div>
      </div>
      <div className={`stage stage-${layout}`}>
        <div className="pane-video">
          <video
            ref={videoRef}
            src={video.src}
            preload="auto"
            playsInline
            onPlay={() => onPlayState(true)}
            onPause={() => onPlayState(false)}
            onEnded={() => onPlayState(false)}
          />
        </div>
        <MapCard
          data={sceneData}
          onScene={onScene}
          layout={layout}
          settings={settings}
          positionReadout={formatTimeReadout(0, video.fps, durationSec)}
          positionRef={positionRef}
        />
        {notice ? <div className="player-notices">{notice}</div> : null}
      </div>
    </div>
  );
}
