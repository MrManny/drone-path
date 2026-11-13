'use client';

import { formatTime } from '../lib/frametime.js';

export interface WorkspaceHeaderProps {
  /** Recording length in seconds; null while no recording is loaded. */
  durationSec: number | null;
}

export function WorkspaceHeader({ durationSec }: WorkspaceHeaderProps) {
  return (
    <header className="workspace-header">
      <div className="brand">
        <span className="brand-name">drone</span>
        <span className="brand-light"> / path</span>
      </div>
      <div className="header-divider" />
      <div className="header-project">
        <strong>Flight workspace</strong>
        {durationSec === null ? null : <small>{`Recording · ${formatTime(durationSec)}`}</small>}
      </div>
    </header>
  );
}
