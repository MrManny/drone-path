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
  /** True while the event target sits inside the menu bar (label navigation). */
  inBar?: (target: unknown) => boolean;
}

interface MenuKeys {
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
  'Home',
  'End',
]);

const LABEL_NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
  'Enter',
  ' ',
  'Spacebar',
]);

export function useMenuKeys(flags: MenuFlags, options: MenuKeysOptions): MenuKeys {
  const [state, setState] = useState<MenuState>(INITIAL_MENU_STATE);
  // Events arrive faster than renders; the ref keeps every transition applied
  // to the latest state instead of a stale closure.
  const stateRef = useRef(state);
  const flagsRef = useRef(flags);
  const optionsRef = useRef(options);
  const suppressSpaceKeyUpRef = useRef(false);
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
      // AltGr types characters through Ctrl+Alt (Cmd+Alt) chords on European
      // layouts; those must reach the text field instead of the menu.
      const plain = !e.ctrlKey && !e.metaKey;
      const accel = plain && (e.key === 'Alt' || (e.altKey && /^[a-z]$/i.test(e.key)));
      const labelNav =
        plain &&
        !e.altKey &&
        !open &&
        LABEL_NAV_KEYS.has(e.key) &&
        (optionsRef.current.inBar?.(e.target) ?? false);
      const claimed = accel || (open && NAV_KEYS.has(e.key)) || labelNav;
      if (!claimed) return;
      // Suppress the browser's synthetic Space keyup click on the label button
      // after closed-bar Space already opened the menu on keydown.
      suppressSpaceKeyUpRef.current = labelNav && (e.key === ' ' || e.key === 'Spacebar');
      // While a menu is open it owns the keyboard; otherwise only the Alt
      // accelerators and the closed bar's label keys are claimed. Claimed
      // keys are exclusive: the player hotkey listener sits on the same
      // window target (registered later — child effects run first), and
      // stopPropagation alone would still let it run.
      e.preventDefault();
      e.stopImmediatePropagation();
      dispatch({
        type: 'keyDown',
        key: e.key,
        altKey: e.altKey,
        repeat: e.repeat,
      });
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (optionsRef.current.modalOpen) return;
      if ((e.key === ' ' || e.key === 'Spacebar') && suppressSpaceKeyUpRef.current) {
        suppressSpaceKeyUpRef.current = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key !== 'Alt' || e.ctrlKey || e.metaKey) return;
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
