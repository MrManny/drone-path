'use client';

import type { Dialogs } from '../hooks/useDialogs.js';
import type { PickState } from '../lib/pickstate.js';
import { EmptyStage } from './EmptyStage.js';
import type { WorkspaceMode } from './WorkspaceHeader.js';
import { WorkspaceShell } from './WorkspaceShell.js';

interface EmptyWorkspaceProps {
  state: PickState;
  onPick: () => void;
  onOpenFolder?: () => void;
  onHelp: () => void;
  onExit: () => void;
  onDismiss?: () => void;
  mode?: WorkspaceMode;
  showModeSwitch?: boolean;
  onModeChange?: (mode: WorkspaceMode) => void;
  dialogs: Dialogs;
}

export function EmptyWorkspace({
  state,
  onPick,
  onOpenFolder,
  onHelp,
  onExit,
  onDismiss,
  mode,
  showModeSwitch,
  onModeChange,
  dialogs,
}: EmptyWorkspaceProps) {
  return (
    <WorkspaceShell
      hasRecording={false}
      opening={state.kind === 'preparing'}
      durationSec={null}
      dialogs={dialogs}
      onOpen={onPick}
      onOpenFolder={onOpenFolder}
      onHelp={onHelp}
      onExit={onExit}
      mode={mode}
      showModeSwitch={showModeSwitch}
      onModeChange={onModeChange}
      stage={<EmptyStage state={state} onPick={onPick} onDismiss={onDismiss} />}
    />
  );
}
