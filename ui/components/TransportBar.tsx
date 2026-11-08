'use client';

import type { RefObject } from 'react';

import { formatTimeReadout } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';
import { PauseIcon } from '../icons/PauseIcon.js';
import { PlayIcon } from '../icons/PlayIcon.js';
import { SkipBackIcon } from '../icons/SkipBackIcon.js';
import { SkipForwardIcon } from '../icons/SkipForwardIcon.js';

export interface TransportBarProps {
  /** The player's action map: buttons and hotkeys drive the same actions. */
  dispatch: (action: HotkeyAction) => void;
  /** No recording is loaded: the whole cluster and speed group are off. */
  disabled?: boolean;
  ready: boolean;
  playing: boolean;
  speed: 1 | 2 | 3 | 4;
  /** Raw timeline values; the bar formats its own readouts from them. */
  fps: number;
  durationSec: number;
  /** The imperative "position / duration" readout. */
  timeRef: RefObject<HTMLSpanElement | null>;
}

export function TransportBar({
  dispatch,
  disabled = false,
  ready,
  playing,
  speed,
  fps,
  durationSec,
  timeRef,
}: TransportBarProps) {
  return (
    <div className="transport">
      <span className="readout transport-time" ref={timeRef}>
        {formatTimeReadout(0, fps, durationSec)}
      </span>
      <div className="transport-group transport-cluster">
        <button
          type="button"
          className="transport-step"
          aria-label="Jump to start"
          title="Jump to start (Home)"
          disabled={disabled}
          onClick={() => dispatch({ type: 'seekStart' })}
        >
          <SkipBackIcon />
        </button>
        <button
          type="button"
          className="transport-play"
          onClick={() => dispatch({ type: 'togglePlay' })}
          disabled={disabled || !ready}
        >
          {ready && playing ? <PauseIcon /> : <PlayIcon />}
          {ready && playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="transport-step"
          aria-label="Jump to end"
          title="Jump to end (End)"
          disabled={disabled}
          onClick={() => dispatch({ type: 'seekEnd' })}
        >
          <SkipForwardIcon />
        </button>
      </div>
      <div className="transport-group transport-speed">
        <span className="transport-label">Playback speed</span>
        <div className="segmented" role="group" aria-label="Playback speed">
          {([1, 2, 3, 4] as const).map((rate) => (
            <button
              key={rate}
              type="button"
              className="segment"
              aria-pressed={speed === rate}
              title={`Playback speed ${rate}× (${rate})`}
              disabled={disabled}
              onClick={() => dispatch({ type: 'speed', rate })}
            >
              {rate}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
