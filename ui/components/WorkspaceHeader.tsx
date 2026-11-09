'use client';

import { formatTime } from '../lib/frametime.js';
import { FolderOpenIcon } from '../icons/FolderOpenIcon.js';
import { ExportIcon } from '../icons/ExportIcon.js';
import { TelemetryIcon } from '../icons/TelemetryIcon.js';

export interface WorkspaceHeaderProps {
  durationSec: number;
  opening: boolean;
  disabled?: boolean;
  telemetryScope: string;
  onOpen: () => void;
  onExport: () => void;
  onTelemetrySave: () => void;
}

export function WorkspaceHeader({
  durationSec,
  opening,
  disabled = false,
  telemetryScope,
  onOpen,
  onExport,
  onTelemetrySave,
}: WorkspaceHeaderProps) {
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
      <div className="header-spacer" />
      <button type="button" onClick={onOpen} disabled={opening}>
        <FolderOpenIcon />
        Open…
      </button>
      <button type="button" onClick={onExport} disabled={disabled}>
        <ExportIcon />
        Export…
      </button>
      <button
        type="button"
        onClick={onTelemetrySave}
        disabled={disabled}
        title={`Saves telemetry JSON for the ${telemetryScope}`}
      >
        <TelemetryIcon />
        Save telemetry JSON…
      </button>
    </header>
  );
}
