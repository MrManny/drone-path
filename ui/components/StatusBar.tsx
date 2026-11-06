'use client';

import { formatTime } from '../lib/frametime.js';
import { HelpIcon } from '../icons/HelpIcon.js';

export interface StatusBarProps {
  /** The recording is prepared and playback is available. */
  ready: boolean;
  /** The recording has telemetry; the bar says so when it does. */
  hasTelemetry: boolean;
  durationSec: number;
  onHelp: () => void;
}

// The workspace's bottom status bar: readiness, telemetry and duration at
// the left, Help at the right.
export function StatusBar({ ready, hasTelemetry, durationSec, onHelp }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-item">{ready ? 'Ready' : 'Preparing…'}</span>
      {hasTelemetry ? <span className="status-item">SRT telemetry loaded</span> : null}
      <span className="status-item">{formatTime(durationSec)} duration</span>
      <div className="header-spacer" />
      <button type="button" onClick={onHelp}>
        <HelpIcon />
        Help
      </button>
    </footer>
  );
}
