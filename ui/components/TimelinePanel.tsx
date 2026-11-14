'use client';

import { useRef } from 'react';
import type { RefObject } from 'react';

import { ArrowLeftFromLine, ArrowRightFromLine, X } from 'lucide-react';

import { formatLoopReadout, formatTime, formatTimeReadout, timelineTicks } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';
import type { LoopState } from '../lib/loop.js';
import { clampHandleFrame, frameAtPointer, hasLoop, resolveLoop } from '../lib/loop.js';
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
  const loopPoints = resolveLoop(loop, maxFrame);
  const loopReadout = formatLoopReadout(loop, fps, maxFrame);
  const clearable = hasLoop(loop);

  // The band's end handles are pointer-only by design: they are a drag
  // enhancement of the I/O keys and the in/out-point buttons, which stay the
  // keyboard path (documented in docs/user/keyboard-shortcuts.md).
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
          <span className="readout loop-readout" aria-live="polite" aria-atomic="true">
            {loopReadout}
          </span>
          <div className="segmented" role="group" aria-label="In and out points">
            <button
              type="button"
              className="segment segment-icon"
              aria-label="Set in point"
              title="Set in point (I)"
              disabled={disabled}
              onClick={() => dispatch({ type: 'setLoopIn' })}
            >
              <ArrowRightFromLine size={16} />
            </button>
            <button
              type="button"
              className="segment segment-icon"
              aria-label="Set out point"
              title="Set out point (O)"
              disabled={disabled}
              onClick={() => dispatch({ type: 'setLoopOut' })}
            >
              <ArrowLeftFromLine size={16} />
            </button>
            <button
              type="button"
              className="segment segment-icon"
              aria-label="Clear in and out points"
              title={clearable ? 'Clear in and out points (Esc)' : 'No in or out point to clear'}
              disabled={disabled || !clearable}
              onClick={() => dispatch({ type: 'clearLoop' })}
            >
              <X size={16} />
            </button>
          </div>
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
            {/* A handle marks only a set boundary; a lone point's open end is the track edge. */}
            {loop.in !== null ? (
              <span
                className="loop-handle loop-handle-in"
                title="In point (I)"
                onPointerDown={() => startDrag('in')}
              />
            ) : null}
            {loop.out !== null ? (
              <span
                className="loop-handle loop-handle-out"
                title="Out point (O)"
                onPointerDown={() => startDrag('out')}
              />
            ) : null}
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
          onChange={(e) => {
            const frame = Number(e.currentTarget.value);
            // Keyboard scrubbing announces the time, not the raw frame index.
            e.currentTarget.setAttribute('aria-valuetext', formatTimeReadout(frame, fps, durationSec));
            scrubTo(frame);
          }}
        />
      </div>
    </section>
  );
}
