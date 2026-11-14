'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

import { framesForSeconds } from '../lib/frametime.js';
import type { HotkeyAction, HotkeySession } from '../lib/hotkeys.js';
import { INITIAL_SESSION, mapKey } from '../lib/hotkeys.js';

export interface PlayerActionHandlers {
  togglePlay: () => void;
  setSpeed: (rate: 1 | 2 | 3 | 4) => void;
  stepBy: (deltaFrames: number) => void;
  scrubTo: (i: number) => void;
  setLoopPoint: (which: 'in' | 'out') => void;
  clearLoop: () => void;
  swap: () => void;
  openRecording: () => void;
  closeOverlay: () => void;
}

interface PlayerActionContext {
  modalOpen: boolean;
  popoverOpen: boolean;
  menuOpen: boolean;
  fps: number;
  frames: number;
}

export function usePlayerHotkeys(
  handlers: PlayerActionHandlers,
  ctx: PlayerActionContext,
): (action: HotkeyAction) => void {
  const dispatch = (action: HotkeyAction): void => {
    switch (action.type) {
      case 'togglePlay':
        handlers.togglePlay();
        return;
      case 'speed':
        handlers.setSpeed(action.rate);
        return;
      case 'step':
        handlers.stepBy(action.frames);
        return;
      case 'jump':
        handlers.stepBy(framesForSeconds(ctx.fps, action.seconds));
        return;
      case 'seekStart':
        handlers.scrubTo(0);
        return;
      case 'seekEnd':
        handlers.scrubTo(ctx.frames - 1);
        return;
      case 'setLoopIn':
        handlers.setLoopPoint('in');
        return;
      case 'setLoopOut':
        handlers.setLoopPoint('out');
        return;
      case 'clearLoop':
        handlers.clearLoop();
        return;
      case 'swapView':
        handlers.swap();
        return;
      case 'openRecording':
        handlers.openRecording();
        return;
      case 'closeOverlay':
        handlers.closeOverlay();
        return;
    }
  };

  const hotkeyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const sessionRef = useRef<HotkeySession>(INITIAL_SESSION);
  useLayoutEffect(() => {
    hotkeyHandlerRef.current = (e: KeyboardEvent): void => {
      const { action, session } = mapKey(
        e,
        { modalOpen: ctx.modalOpen, popoverOpen: ctx.popoverOpen, menuOpen: ctx.menuOpen },
        sessionRef.current,
      );
      sessionRef.current = session;
      if (action === null) return;
      e.preventDefault();
      e.stopPropagation();
      dispatch(action);
    };
  });

  // Capture phase so claimed keys win over the map's keyboard pan/zoom; keys
  // this player does not claim still reach whatever holds focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => hotkeyHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return dispatch;
}
