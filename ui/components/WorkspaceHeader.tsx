'use client';

import { formatTime } from '../lib/frametime.js';

export interface WorkspaceHeaderProps {
  durationSec: number;
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
        <small>{`Recording · ${formatTime(durationSec)}`}</small>
      </div>
    </header>
  );
}
