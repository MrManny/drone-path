'use client';

import type { ReactNode, RefObject } from 'react';

import type { PageVideo } from '../../src/appsession.js';
import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { StageLayout } from '../lib/layout.js';
import { MapCard } from './MapCard.js';

interface PlayerStageProps {
  video: PageVideo;
  sceneData: SceneData;
  layout: StageLayout;
  videoRef: RefObject<HTMLVideoElement | null>;
  onScene: (scene: Scene) => void;
  onPlayState: (playing: boolean) => void;
  notice: ReactNode;
}

export function PlayerStage({
  video,
  sceneData,
  layout,
  videoRef,
  onScene,
  onPlayState,
  notice,
}: PlayerStageProps) {
  return (
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
      <MapCard data={sceneData} onScene={onScene} layout={layout} />
      {notice ? <div className="player-notices">{notice}</div> : null}
    </div>
  );
}
