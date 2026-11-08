'use client';

// The workspace before a recording loads: the full row skeleton in its
// disabled quiet state with the open call to action in the stage. The rows
// and the hotkey wiring match the player, so committing a recording swaps
// the content without moving anything.

import { useRef } from 'react';

import type { Dialogs } from '../hooks/useDialogs.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import type { LoopState } from '../lib/loop.js';
import type { PickState } from '../lib/pickstate.js';
import { EmptyStage } from './EmptyStage.js';
import { StatusBar } from './StatusBar.js';
import { TimelinePanel } from './TimelinePanel.js';
import { TransportBar } from './TransportBar.js';
import { WorkspaceHeader } from './WorkspaceHeader.js';

export interface EmptyWorkspaceProps {
  state: PickState;
  onPick: () => void;
  onHelp: () => void;
  onDismiss?: () => void;
  /** The app's one dialog machine, shared with the update prompt at page level. */
  dialogs: Dialogs;
}

const NOOP = (): void => {};
const NO_LOOP: LoopState = { in: null, out: null };

export function EmptyWorkspace({
  state,
  onPick,
  onHelp,
  onDismiss,
  dialogs,
}: EmptyWorkspaceProps) {
  const timeRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  // Same wiring as the player: Ctrl+O opens a recording, every playback
  // shortcut no-ops until one is loaded, Escape closes the topmost dialog.
  const dispatch = usePlayerHotkeys(
    {
      togglePlay: NOOP,
      setSpeed: NOOP,
      stepBy: NOOP,
      scrubTo: NOOP,
      setLoopPoint: NOOP,
      clearLoop: NOOP,
      swap: NOOP,
      openRecording: onPick,
      closeOverlay: () => dialogs.dispatchDialog({ type: 'close' }),
    },
    { modalOpen: dialogs.modalOpen, popoverOpen: false, fps: 0, frames: 0 },
  );

  return (
    <div className="workspace">
      <WorkspaceHeader
        durationSec={0}
        opening={state.kind === 'preparing'}
        disabled
        onOpen={onPick}
        onExport={NOOP}
      />
      <EmptyStage state={state} onPick={onPick} onDismiss={onDismiss} />
      <TransportBar
        dispatch={dispatch}
        disabled
        ready={false}
        playing={false}
        speed={1}
        fps={0}
        durationSec={0}
        timeRef={timeRef}
      />
      <TimelinePanel
        dispatch={dispatch}
        disabled
        loop={NO_LOOP}
        setLoopFrame={NOOP}
        fps={0}
        frames={0}
        durationSec={0}
        maxFrame={0}
        scrubTo={NOOP}
        scrubRef={scrubRef}
        playheadRef={playheadRef}
        src=""
      />
      <StatusBar
        disabled
        hasTelemetry={false}
        onMapSettings={NOOP}
        mapSettingsOpen={false}
        onSwap={NOOP}
        onHelp={onHelp}
      />
    </div>
  );
}
