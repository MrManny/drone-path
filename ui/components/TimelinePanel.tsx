'use client';

import { useRef } from 'react';
import type { RefObject } from 'react';

import { ArrowLeftFromLine, ArrowRightFromLine, X } from 'lucide-react';

import { formatLoopReadout, formatTime, timelineTicks } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';
import type { LoopState } from '../lib/loop.js';
import { clampHandleFrame, engagedLoop, frameAtPointer, hasLoop } from '../lib/loop.js';
import { Filmstrip } from './Filmstrip.js';

export interface TimelinePanelProps {
  dispatch: (action: HotkeyAction) => void;
  disabled?: boolean;
  loop: LoopState;
  setLoopFrame: (which: 'in' | 'out', frame: number) => void;
  fps: number;
  frames: number;
  durationSec: number;
  maxFrame: number;
  scrubTo: (i: number) => void;
  scrubRef: RefObject<HTMLInputElement | null>;
  playheadRef: RefObject<HTMLDivElement | null>;
  src: string;
}

export function TimelinePanel({
  dispatch,
  disabled = false,
  loop,
  setLoopFrame,
  fps,
  frames,
  durationSec,
  maxFrame,
  scrubTo,
  scrubRef,
  playheadRef,
  src,
}: TimelinePanelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const bandPct = (i: number): number => (maxFrame > 0 ? (i / maxFrame) * 100 : 0);
  const loopPoints = engagedLoop(loop);
  const loopReadout = formatLoopReadout(loop, fps);
  const clearable = hasLoop(loop);

  const startDrag = (which: 'in' | 'out'): void => {
    const track = trackRef.current;
    if (!track) return;
    const move = (ev: PointerEvent): void => {
      const frame = frameAtPointer(ev.clientX, track.getBoundingClientRect(), maxFrame);
      setLoopFrame(which, clampHandleFrame(which, frame, loop, maxFrame));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <section className="timeline">
      <div className="timeline-header">
        <div className="timeline-heading">
          <span className="preview-title">Timeline</span>
        </div>
        <div className="timeline-actions">
          <button
            type="button"
            aria-label="Set loop in"
            title="Set loop in (I)"
            disabled={disabled}
            onClick={() => dispatch({ type: 'setLoopIn' })}
          >
            <ArrowRightFromLine size={16} />
          </button>
          <button
            type="button"
            aria-label="Set loop out"
            title="Set loop out (O)"
            disabled={disabled}
            onClick={() => dispatch({ type: 'setLoopOut' })}
          >
            <ArrowLeftFromLine size={16} />
          </button>
          <button
            type="button"
            aria-label="Clear loop"
            title={clearable ? 'Clear loop (Esc)' : 'No loop to clear.'}
            disabled={disabled || !clearable}
            onClick={() => dispatch({ type: 'clearLoop' })}
          >
            <X size={16} />
          </button>
          {loopReadout ? <span className="readout loop-readout">{loopReadout}</span> : null}
        </div>
      </div>
      <div className="ruler">
        {timelineTicks(durationSec).map((tick) => {
          const pct = bandPct(Math.round(tick * fps));
          return (
            <span
              key={tick}
              className="ruler-tick"
              style={{
                left: `${Math.min(100, pct)}%`,
                transform:
                  pct <= 0 ? 'none' : pct >= 100 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {formatTime(tick)}
            </span>
          );
        })}
      </div>
      <div className="track" ref={trackRef}>
        {disabled ? null : <Filmstrip src={src} frames={frames} fps={fps} />}
        {loopPoints ? (
          <div
            className="loop-band"
            style={{
              left: `${bandPct(loopPoints.in)}%`,
              width: `${bandPct(loopPoints.out) - bandPct(loopPoints.in)}%`,
            }}
          >
            <span
              className="loop-handle loop-handle-in"
              title="Loop in (I)"
              onPointerDown={() => startDrag('in')}
            />
            <span
              className="loop-handle loop-handle-out"
              title="Loop out (O)"
              onPointerDown={() => startDrag('out')}
            />
          </div>
        ) : null}
        <div className="playhead" ref={playheadRef} />
        <input
          ref={scrubRef}
          type="range"
          aria-label="Playback position"
          min={0}
          max={maxFrame}
          step={1}
          defaultValue={0}
          disabled={disabled}
          onChange={(e) => scrubTo(Number(e.target.value))}
        />
      </div>
    </section>
  );
}
