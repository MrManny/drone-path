'use client';

import type { PickState } from '../lib/pickstate.js';
import { FolderOpenIcon } from '../icons/FolderOpenIcon.js';
import { HelpIcon } from '../icons/HelpIcon.js';
import { OpenNotice } from './OpenNotice.js';

export interface LandingPanelProps {
  state: PickState;
  onPick: () => void;
  onHelp: () => void;
  onDismiss?: () => void;
}

export function LandingPanel({ state, onPick, onHelp, onDismiss }: LandingPanelProps) {
  const preparing = state.kind === 'preparing';
  return (
    <main className="landing">
      <h1>neo2-flightpath</h1>
      <p>
        Pick a drone recording to watch its flight path on the map in sync with
        the footage.
      </p>
      <div className="landing-actions">
        <button type="button" className="primary" onClick={onPick} disabled={preparing}>
          <FolderOpenIcon />
          {preparing ? 'Preparing…' : 'Open…'}
        </button>
        <button type="button" onClick={onHelp}>
          <HelpIcon />
          Help
        </button>
      </div>
      <OpenNotice state={state} onDismiss={onDismiss} />
      <p className="hint">
        Requires ffmpeg/ffprobe on PATH. An .SRT sidecar next to the video is
        picked up automatically.
      </p>
    </main>
  );
}
