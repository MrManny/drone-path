'use client';

import { useRef } from 'react';

import type { Dialogs } from '../hooks/useDialogs.js';
import type { LoopState } from '../lib/loop.js';
import type { PickState } from '../lib/pickstate.js';
import { EmptyStage } from './EmptyStage.js';
import { WorkspaceShell } from './WorkspaceShell.js';

interface EmptyWorkspaceProps {
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

  return (
    <WorkspaceShell
      hasRecording={false}
      opening={state.kind === 'preparing'}
      durationSec={null}
      dialogs={dialogs}
      onOpen={onPick}
      onHelp={onHelp}
      onExit={onExit}
      hotkeyHandlers={{
        togglePlay: NOOP,
        setSpeed: NOOP,
        stepBy: NOOP,
        scrubTo: NOOP,
        setLoopPoint: NOOP,
        clearLoop: NOOP,
        swap: NOOP,
        zoomStep: NOOP,
      }}
      hotkeyTiming={{ fps: 0, frames: 0 }}
      stage={<EmptyStage state={state} onPick={onPick} onDismiss={onDismiss} />}
      transport={{
        disabled: true,
        ready: false,
        playing: false,
        speed: 1,
        fps: 0,
        durationSec: 0,
        timeRef,
      }}
      timeline={{
        disabled: true,
        loop: NO_LOOP,
        setLoopFrame: NOOP,
        fps: 0,
        frames: 0,
        durationSec: 0,
        maxFrame: 0,
        scrubTo: NOOP,
        scrubRef,
        playheadRef,
        src: '',
      }}
    />
  );
}
