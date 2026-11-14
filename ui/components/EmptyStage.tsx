'use client';

import type { PickState } from '../lib/pickstate.js';
import { FolderOpen } from 'lucide-react';
import { MapCard } from './MapCard.js';
import { OpenNotice } from './OpenNotice.js';

interface EmptyStageProps {
  state: PickState;
  onPick: () => void;
  onDismiss?: () => void;
}

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
            <FolderOpen size={16} />
            {preparing ? 'Preparing…' : 'Open…'}
          </button>
          {notice}
          <p>
            Pick a drone recording to watch its flight path on the map in sync as
            you play.
          </p>
        </div>
      </div>
      <MapCard data={null} layout="split" />
    </div>
  );
}
