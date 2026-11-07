'use client';

import type { RefObject } from 'react';

import { HelpIcon } from '../icons/HelpIcon.js';
import { SettingsIcon } from '../icons/SettingsIcon.js';
import { SwapIcon } from '../icons/SwapIcon.js';

export interface StatusBarProps {
  /** The recording has telemetry; the bar says so when it does. */
  hasTelemetry: boolean;
  /** Toggles the map appearance popover. */
  onMapSettings: () => void;
  mapSettingsOpen: boolean;
  /** Focus returns here when the map appearance popover closes. */
  settingsButtonRef?: RefObject<HTMLButtonElement | null>;
  onSwap: () => void;
  onHelp: () => void;
}

export function StatusBar({
  hasTelemetry,
  onMapSettings,
  mapSettingsOpen,
  settingsButtonRef,
  onSwap,
  onHelp,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      {hasTelemetry ? <span className="status-item">SRT telemetry loaded</span> : null}
      <div className="header-spacer" />
      <button
        type="button"
        ref={settingsButtonRef}
        aria-label="Map settings"
        title="Map settings"
        aria-expanded={mapSettingsOpen}
        onClick={onMapSettings}
      >
        <SettingsIcon />
      </button>
      <button type="button" aria-label="Swap" title="Swap (S)" onClick={onSwap}>
        <SwapIcon />
      </button>
      <button type="button" aria-label="Help" title="Help" onClick={onHelp}>
        <HelpIcon />
      </button>
    </footer>
  );
}
