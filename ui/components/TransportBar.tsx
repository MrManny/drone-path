'use client';

import type { RefObject } from 'react';

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';

import { formatTimeReadout } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';

export interface TransportBarProps {
  dispatch: (action: HotkeyAction) => void;
  disabled?: boolean;
  ready: boolean;
  playing: boolean;
  speed: 1 | 2 | 3 | 4;
  fps: number;
  durationSec: number;
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
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          className="transport-step"
          aria-label={ready && playing ? 'Pause' : 'Play'}
          title={ready && playing ? 'Pause (Space / K)' : 'Play (Space / K)'}
          onClick={() => dispatch({ type: 'togglePlay' })}
          disabled={disabled || !ready}
        >
          {ready && playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          className="transport-step"
          aria-label="Jump to end"
          title="Jump to end (End)"
          disabled={disabled}
          onClick={() => dispatch({ type: 'seekEnd' })}
        >
          <SkipForward size={16} />
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
              title={`Playback speed ${rate}× (key ${rate})`}
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
