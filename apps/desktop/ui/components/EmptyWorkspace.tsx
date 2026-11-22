'use client';

import type { Dialogs } from '../hooks/useDialogs.js';
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

export function EmptyWorkspace({
  state,
  onPick,
  onHelp,
  onExit,
  onDismiss,
  dialogs,
}: EmptyWorkspaceProps) {
  return (
    <WorkspaceShell
      hasRecording={false}
      opening={state.kind === 'preparing'}
      durationSec={null}
      dialogs={dialogs}
      onOpen={onPick}
      onHelp={onHelp}
      onExit={onExit}
      stage={<EmptyStage state={state} onPick={onPick} onDismiss={onDismiss} />}
    />
  );
}
