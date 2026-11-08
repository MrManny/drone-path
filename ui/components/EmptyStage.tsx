'use client';

import type { PickState } from '../lib/pickstate.js';
import { FolderOpenIcon } from '../icons/FolderOpenIcon.js';
import { MapCard } from './MapCard.js';
import { OpenNotice } from './OpenNotice.js';

export interface EmptyStageProps {
  state: PickState;
  onPick: () => void;
  onDismiss?: () => void;
}

// The stage before a recording loads: the open call to action centered in the
// footage pane and an empty map rail. It reuses the player's stage geometry,
// so committing a recording swaps the content without moving a single row.
export function EmptyStage({ state, onPick, onDismiss }: EmptyStageProps) {
  const preparing = state.kind === 'preparing';
  const notice =
    state.kind === 'preparing' || state.kind === 'canceled' || state.kind === 'error' ? (
      <OpenNotice state={state} onDismiss={onDismiss} />
    ) : null;
  return (
    <div className="stage stage-split">
      <div className="pane-video">
        <div className="stage-empty">
          <button type="button" className="primary" onClick={onPick} disabled={preparing}>
            <FolderOpenIcon />
            {preparing ? 'Preparing…' : 'Open…'}
          </button>
          <p>
            Pick a drone recording to watch its flight path on the map in sync with
            the footage.
          </p>
          <p className="hint">
            ffmpeg/ffprobe are bundled; an .SRT sidecar next to the video is picked
            up automatically.
          </p>
        </div>
      </div>
      <MapCard data={null} layout="split" />
      {notice ? <div className="player-notices">{notice}</div> : null}
    </div>
  );
}
