'use client';

import { formatTime } from '../lib/frametime.js';
import { FolderOpenIcon } from '../icons/FolderOpenIcon.js';
import { ExportIcon } from '../icons/ExportIcon.js';

export interface WorkspaceHeaderProps {
  /** The open recording's length, shown in the project slot. */
  durationSec: number;
  /** The Open flow is preparing: the button is disabled. */
  opening: boolean;
  onOpen: () => void;
  onExport: () => void;
}

export function WorkspaceHeader({ durationSec, opening, onOpen, onExport }: WorkspaceHeaderProps) {
  return (
    <header className="workspace-header">
      <div className="brand">
        <span className="brand-name">neo2</span>
        <span className="brand-light"> / flightpath</span>
      </div>
      <div className="header-divider" />
      <div className="header-project">
        <strong>Flight workspace</strong>
        <small>{`Recording · ${formatTime(durationSec)}`}</small>
      </div>
      <div className="header-spacer" />
      <button type="button" onClick={onOpen} disabled={opening}>
        <FolderOpenIcon />
        Open…
      </button>
      <button type="button" onClick={onExport}>
        <ExportIcon />
        Export…
      </button>
    </header>
  );
}
