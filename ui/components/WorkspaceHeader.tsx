'use client';

import { formatTime } from '../lib/frametime.js';
import { FolderOpenIcon } from '../icons/FolderOpenIcon.js';
import { ExportIcon } from '../icons/ExportIcon.js';

export interface WorkspaceHeaderProps {
  /** The open recording's length, shown in the project slot. */
  durationSec: number;
  /** The recording is prepared and playback is available. */
  ready: boolean;
  /** The Open flow is preparing: the button is busy and says so. */
  opening: boolean;
  onOpen: () => void;
  onExport: () => void;
}

export function WorkspaceHeader({
  durationSec,
  ready,
  opening,
  onOpen,
  onExport,
}: WorkspaceHeaderProps) {
  const status = opening ? 'Preparing recording…' : ready ? 'Video + telemetry ready' : 'Warming tiles…';
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
      <div className="header-status">{status}</div>
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
