'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MenuFlags, MenuItemId } from '../lib/menumodel.js';
import { INITIAL_MENU_STATE, reduceMenu } from '../lib/menustate.js';
import type { MenuEvent, MenuState } from '../lib/menustate.js';

export interface MenuKeysOptions {
  /** Menu keys are inert while a modal dialog holds the workspace. */
  modalOpen: boolean;
  /** Runs the item the reducer just approved; the reducer closes the menu. */
  onActivate: (item: MenuItemId) => void;
  /** Reports open/closed transitions so player hotkeys can yield the keyboard. */
  onOpenChange: (open: boolean) => void;
}

export interface MenuKeys {
  state: MenuState;
  dispatch: (event: MenuEvent) => void;
}

const NAV_KEYS = new Set([
  'Escape',
  'Enter',
  ' ',
  'Spacebar',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export function useMenuKeys(flags: MenuFlags, options: MenuKeysOptions): MenuKeys {
  const [state, setState] = useState<MenuState>(INITIAL_MENU_STATE);
  // Events arrive faster than renders; the ref keeps every transition applied
  // to the latest state instead of a stale closure.
  const stateRef = useRef(state);
  const flagsRef = useRef(flags);
  const optionsRef = useRef(options);
  // Event handlers read the latest props through these refs.
  useEffect(() => {
    flagsRef.current = flags;
    optionsRef.current = options;
  });

  const dispatch = useCallback((event: MenuEvent) => {
    const result = reduceMenu(stateRef.current, event, flagsRef.current);
    if (result.state === stateRef.current) return;
    const wasOpen = stateRef.current.open !== null;
    stateRef.current = result.state;
    setState(result.state);
    const { onActivate, onOpenChange } = optionsRef.current;
    if (result.command) onActivate(result.command.item);
    const isOpen = result.state.open !== null;
    if (isOpen !== wasOpen) onOpenChange(isOpen);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (optionsRef.current.modalOpen) return;
      const open = stateRef.current.open !== null;
      const claimed =
        e.key === 'Alt' || (e.altKey && /^[a-z]$/i.test(e.key)) || (open && NAV_KEYS.has(e.key));
      if (!claimed) return;
      // While a menu is open it owns the keyboard; otherwise only the Alt
      // accelerators are claimed.
      e.preventDefault();
      e.stopPropagation();
      dispatch({
        type: 'keyDown',
        key: e.key,
        altKey: e.altKey,
        repeat: e.repeat,
      });
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key !== 'Alt' || optionsRef.current.modalOpen) return;
      dispatch({ type: 'keyUp', key: 'Alt' });
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [dispatch]);

  return { state, dispatch };
}
