'use client';

import { useCallback, useRef, useState } from 'react';

import type { RenderConfig } from '../../src/config.js';
import type { Dialogs } from '../hooks/useDialogs.js';
import { useMapAppearance } from '../hooks/useMapAppearance.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
import type { LoopState } from '../lib/loop.js';
import type { MenuItemId } from '../lib/menumodel.js';
import { closeOverlayTarget } from '../lib/overlayrouting.js';
import type { PickState } from '../lib/pickstate.js';
import { EmptyStage } from './EmptyStage.js';
import { MenuBar } from './MenuBar.js';
import { Popover } from './Popover.js';
import { SettingsPanel } from './SettingsPanel.js';
import { TimelinePanel } from './TimelinePanel.js';
import { TransportBar } from './TransportBar.js';
import { WorkspaceHeader } from './WorkspaceHeader.js';

interface EmptyWorkspaceProps {
  state: PickState;
  /** Map appearance applies to future exports, so it is live from startup. */
  settings: RenderConfig;
  onSettingsChange: (config: RenderConfig) => void;
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
  settings,
  onSettingsChange,
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
  const {
    open: mapAppearanceOpen,
    toggle: toggleMapAppearance,
    close: closeMapAppearance,
    triggerRef: appearanceButtonRef,
  } = useMapAppearance();

  const closeOverlay = useCallback(() => {
    const target = closeOverlayTarget({
      modalOpen: dialogs.modalOpen,
      popoverOpen: mapAppearanceOpen,
    });
    if (target === 'modal') dialogs.dispatchDialog({ type: 'close' });
    else if (target === 'popover') closeMapAppearance();
  }, [dialogs, mapAppearanceOpen, closeMapAppearance]);

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
      closeOverlay,
    },
    {
      modalOpen: dialogs.modalOpen,
      popoverOpen: mapAppearanceOpen,
      menuOpen,
      fps: 0,
      frames: 0,
    },
  );

  // Recording-only items stay disabled with nothing loaded, so they need no handler.
  const menuActions: Partial<Record<MenuItemId, () => void>> = {
    open: onPick,
    settings: toggleMapAppearance,
    documentation: onHelp,
    about: () => dialogs.dispatchDialog({ type: 'openAbout' }),
    exit: onExit,
  };

  return (
    <div className="workspace">
      <MenuBar
        hasRecording={false}
        opening={state.kind === 'preparing'}
        modalOpen={dialogs.modalOpen}
        onActivate={(item) => menuActions[item]?.()}
        onMenuOpenChange={setMenuOpen}
        barRef={appearanceButtonRef}
      />
      <WorkspaceHeader durationSec={null} />
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
      {mapAppearanceOpen ? (
        <Popover label="Map appearance" triggerRef={appearanceButtonRef} onClose={closeMapAppearance}>
          <SettingsPanel
            config={settings}
            hasRecording={false}
            hasAltitude={false}
            onChange={onSettingsChange}
          />
        </Popover>
      ) : null}
    </div>
  );
}
