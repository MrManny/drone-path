'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import type { Dialogs } from '../hooks/useDialogs.js';
import type { PlayerActionHandlers } from '../hooks/usePlayerHotkeys.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import type { MenuItemId } from '../lib/menumodel.js';
import { MenuBar } from './MenuBar.js';
import { TimelinePanel } from './TimelinePanel.js';
import type { TimelinePanelProps } from './TimelinePanel.js';
import { TransportBar } from './TransportBar.js';
import type { TransportBarProps } from './TransportBar.js';
import { WorkspaceHeader } from './WorkspaceHeader.js';
import type { WorkspaceMode } from './WorkspaceHeader.js';

interface WorkspaceShellProps {
  hasRecording: boolean;
  opening: boolean;
  durationSec: number | null;
  dialogs: Dialogs;
  onOpen: () => void;
  onOpenFolder?: () => void;
  onHelp: () => void;
  onExit: () => void;
  mode?: WorkspaceMode;
  showModeSwitch?: boolean;
  onModeChange?: (mode: WorkspaceMode) => void;
  showFooterControls?: boolean;
  itemTitles?: Partial<Record<MenuItemId, string>>;
  extraActions?: Partial<Record<MenuItemId, () => void>>;
  hotkeyHandlers?: Omit<PlayerActionHandlers, 'openRecording' | 'closeOverlay'>;
  hotkeyTiming?: { fps: number; frames: number };
  stage: ReactNode;
  transport?: Omit<TransportBarProps, 'dispatch'>;
  timeline?: Omit<TimelinePanelProps, 'dispatch'>;
  children?: ReactNode;
}

export function WorkspaceShell({
  hasRecording,
  opening,
  durationSec,
  dialogs,
  onOpen,
  onOpenFolder,
  onHelp,
  onExit,
  mode,
  showModeSwitch,
  onModeChange,
  showFooterControls = true,
  itemTitles,
  extraActions,
  hotkeyHandlers,
  hotkeyTiming,
  stage,
  transport,
  timeline,
  children,
}: WorkspaceShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { active, modalOpen, dispatchDialog } = dialogs;
  const mapAppearanceOpen = active === 'map-appearance';

  const toggleMapAppearance = useCallback(() => {
    dispatchDialog({ type: mapAppearanceOpen ? 'close' : 'openMapAppearance' });
  }, [mapAppearanceOpen, dispatchDialog]);

  const closeOverlay = useCallback(() => dispatchDialog({ type: 'close' }), [dispatchDialog]);

  const dispatch = usePlayerHotkeys(
    {
      ...hotkeyHandlers,
      openRecording: onOpen,
      closeOverlay,
    },
    {
      modalOpen,
      menuOpen,
      fps: hotkeyTiming?.fps,
      frames: hotkeyTiming?.frames,
    },
  );

  const menuActions: Partial<Record<MenuItemId, () => void>> = {
    open: onOpen,
    openFolder: onOpenFolder,
    appSettings: () => dispatchDialog({ type: 'openSettings' }),
    settings: toggleMapAppearance,
    documentation: onHelp,
    about: () => dispatchDialog({ type: 'openAbout' }),
    exit: onExit,
    ...extraActions,
  };

  return (
    <div className="workspace">
      <MenuBar
        hasRecording={hasRecording}
        opening={opening}
        modalOpen={modalOpen}
        itemTitles={itemTitles}
        onActivate={(item) => menuActions[item]?.()}
        onMenuOpenChange={setMenuOpen}
      />
      <WorkspaceHeader
        durationSec={durationSec}
        mode={mode}
        showModeSwitch={showModeSwitch}
        onModeChange={onModeChange}
      />
      <main className="workspace-main">
        {stage}
        {showFooterControls ? (
          <>
            {transport ? <TransportBar dispatch={dispatch} {...transport} /> : <TransportBar disabled />}
            {timeline ? <TimelinePanel dispatch={dispatch} {...timeline} /> : <TimelinePanel disabled />}
          </>
        ) : null}
      </main>
      {children}
    </div>
  );
}
