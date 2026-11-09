'use client';

import { useRef, useState } from 'react';

import type { Dialogs } from '../hooks/useDialogs.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import type { LoopState } from '../lib/loop.js';
import type { PickState } from '../lib/pickstate.js';
import { EmptyStage } from './EmptyStage.js';
import { MenuBar } from './MenuBar.js';
import { StatusBar } from './StatusBar.js';
import { TimelinePanel } from './TimelinePanel.js';
import { TransportBar } from './TransportBar.js';
import { WorkspaceHeader } from './WorkspaceHeader.js';

export interface EmptyWorkspaceProps {
  state: PickState;
  onPick: () => void;
  onHelp: () => void;
  onExit: () => void;
  onDismiss?: () => void;
  dialogs: Dialogs;
}

const NOOP = (): void => {};
const NO_LOOP: LoopState = { in: null, out: null };

export function EmptyWorkspace({
  state,
  onPick,
  onHelp,
  onExit,
  onDismiss,
  dialogs,
}: EmptyWorkspaceProps) {
  const timeRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
    { modalOpen: dialogs.modalOpen, popoverOpen: false, menuOpen, fps: 0, frames: 0 },
  );

  return (
    <div className="workspace">
      <MenuBar
        hasRecording={false}
        opening={state.kind === 'preparing'}
        modalOpen={dialogs.modalOpen}
        onOpen={onPick}
        onExportVideo={NOOP}
        onExportTelemetry={NOOP}
        onSettings={NOOP}
        onSwap={NOOP}
        onDocumentation={onHelp}
        onAbout={() => dialogs.dispatchDialog({ type: 'openAbout' })}
        onExit={onExit}
        onMenuOpenChange={setMenuOpen}
      />
      <WorkspaceHeader durationSec={0} />
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
      <StatusBar disabled hasTelemetry={false} />
    </div>
  );
}
