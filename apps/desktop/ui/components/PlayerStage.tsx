'use client';

import { useTranslation } from '../lib/i18n.js';
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import type { PageVideo } from '../../shared/ipc.js';
import type { Scene, SceneData } from 'drone-path-engine/renderer/scene';
import type { StageLayout } from '../lib/layout.js';
import type { ZoomControls } from '../lib/mapzoom.js';
import { BusyStatus } from './BusyStatus.js';
import { MapCard } from './MapCard.js';

interface PlayerStageProps {
  video: PageVideo;
  sceneData: SceneData;
  layout: StageLayout;
  videoRef: RefObject<HTMLVideoElement | null>;
  onScene: (scene: Scene) => void;
  onPlayState: (playing: boolean) => void;
  notice: ReactNode;
  zoomControls?: ZoomControls;
}

export function PlayerStage({
  video,
  sceneData,
  layout,
  videoRef,
  onScene,
  onPlayState,
  notice,
  zoomControls,
}: PlayerStageProps) {
  const t = useTranslation();
  const [videoLoading, setVideoLoading] = useState(true);

  return (
    <div className={`stage stage-${layout}`}>
      <div className="pane-video">
        <video
          ref={videoRef}
          src={video.src}
          preload="auto"
          playsInline
          onCanPlay={() => setVideoLoading(false)}
          onLoadedData={() => setVideoLoading(false)}
          onError={() => setVideoLoading(false)}
          onPlay={() => onPlayState(true)}
          onPause={() => onPlayState(false)}
          onEnded={() => onPlayState(false)}
        />
        {videoLoading ? <BusyStatus>{t('playerStage.preparingVideo')}</BusyStatus> : null}
      </div>
      <MapCard data={sceneData} onScene={onScene} layout={layout} zoomControls={zoomControls} />
      {notice ? <div className="player-notices">{notice}</div> : null}
    </div>
  );
}
