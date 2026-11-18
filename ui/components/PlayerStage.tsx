'use client';

import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import type { PageVideo } from '../../src/appsession.js';
import type { Scene, SceneData } from '../../src/renderer/scene.js';
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
  const [videoBusy, setVideoBusy] = useState(true);

  return (
    <div className={`stage stage-${layout}`}>
      <div className="pane-video">
        <video
          ref={videoRef}
          src={video.src}
          preload="auto"
          playsInline
          onCanPlay={() => setVideoBusy(false)}
          onLoadedData={() => setVideoBusy(false)}
          onPlaying={() => setVideoBusy(false)}
          onWaiting={(event) => {
            if (!event.currentTarget.paused) setVideoBusy(true);
          }}
          onError={() => setVideoBusy(false)}
          onPlay={() => onPlayState(true)}
          onPause={() => onPlayState(false)}
          onEnded={() => onPlayState(false)}
        />
        {videoBusy ? <BusyStatus>Preparing video…</BusyStatus> : null}
      </div>
      <MapCard data={sceneData} onScene={onScene} layout={layout} zoomControls={zoomControls} />
      {notice ? <div className="player-notices">{notice}</div> : null}
    </div>
  );
}
