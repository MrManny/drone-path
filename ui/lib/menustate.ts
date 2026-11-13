import type { MenuDef, MenuFlags, MenuItemId, MenuId } from './menumodel.js';
import { MENU_BAR, itemEnabled, menuOf } from './menumodel.js';

/** Which menu is open and which of its rows keyboard/hover highlights. */
export interface MenuState {
  open: MenuId | null;
  /** Index into the open menu's items, or null when nothing is highlighted. */
  active: number | null;
  /** Alt went down and nothing else has been pressed since (Windows menu toggle). */
  altPending: boolean;
  /** Index of the top-level label holding the menubar's single Tab stop. */
  label: number;
}

export const INITIAL_MENU_STATE: MenuState = { open: null, active: null, altPending: false, label: 0 };

/** What the host should run for this transition, if anything. */
type MenuCommand = { type: 'activate'; item: MenuItemId } | null;

interface MenuKeyEvent {
  key: string;
  altKey?: boolean;
  repeat?: boolean;
}

export type MenuEvent =
  | { type: 'toggle'; menu: MenuId }
  | { type: 'hoverMenu'; menu: MenuId }
  | { type: 'hoverRow'; index: number }
  | { type: 'activateRow'; index: number }
  | { type: 'close' }
  | { type: 'keyDown'; key: string; altKey?: boolean; repeat?: boolean }
  | { type: 'keyUp'; key: string };

export interface MenuResult {
  state: MenuState;
  command: MenuCommand;
}

function indexOfMenu(menu: MenuId, defs: readonly MenuDef[]): number {
  const index = defs.findIndex((def) => def.id === menu);
  return index === -1 ? 0 : index;
}

function openMenu(menu: MenuId, active: number | null, defs: readonly MenuDef[]): MenuResult {
  return {
    state: { open: menu, active, altPending: false, label: indexOfMenu(menu, defs) },
    command: null,
  };
}

function closed(state: MenuState): MenuResult {
  // The roving Tab stop survives open/close; only the menu itself goes away.
  // Already-closed states come back untouched so the cheap idempotent
  // "close" pings from outside clicks stay no-ops.
  if (state.open === null && !state.altPending) return { state, command: null };
  return { state: { ...INITIAL_MENU_STATE, label: state.label }, command: null };
}

function moved(state: MenuState, active: number): MenuResult {
  return { state: { ...state, active }, command: null };
}

export function reduceMenu(
  state: MenuState,
  event: MenuEvent,
  flags: MenuFlags,
  defs: readonly MenuDef[] = MENU_BAR,
): MenuResult {
  switch (event.type) {
    case 'toggle':
      // Pointer interaction cancels a pending Alt toggle.
      return state.open === event.menu
        ? closed(state)
        : openMenu(event.menu, null, defs);
    case 'hoverMenu':
      if (state.open === null || state.open === event.menu) {
        // Pointer movement cancels a pending Alt toggle and nothing else.
        return state.altPending ? { state: { ...state, altPending: false }, command: null } : { state, command: null };
      }
      return openMenu(event.menu, null, defs);
    case 'hoverRow':
      if (state.open === null) return { state, command: null };
      return moved({ ...state, altPending: false }, event.index);
    case 'activateRow': {
      if (state.open === null) return { state, command: null };
      const item = menuOf(state.open, defs).items[event.index];
      return item ? activate(state, item.id, flags) : { state, command: null };
    }
    case 'close':
      return closed(state);
    case 'keyDown':
      return keyDown(state, event, flags, defs);
    case 'keyUp':
      return keyUp(state, defs);
  }
}

function keyDown(
  state: MenuState,
  event: MenuKeyEvent & { type: 'keyDown' },
  flags: MenuFlags,
  defs: readonly MenuDef[],
): MenuResult {
  if (event.key === 'Alt') {
    if (event.repeat === true) return { state, command: null };
    return { state: { ...state, altPending: true }, command: null };
  }

  // Alt+F/V/H open their menu directly; the later Alt release must not toggle.
  if (event.altKey === true) {
    const menu = defs.find((def) => def.mnemonic === event.key.toLowerCase());
    return menu ? openMenu(menu.id, 0, defs) : closed(state);
  }

  if (state.altPending) {
    state = { ...state, altPending: false };
  }
  if (state.open === null) {
    // Closed bar: Left/Right walk the top-level labels (single Tab stop).
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const delta = event.key === 'ArrowLeft' ? -1 : 1;
      return { state: { ...state, label: (state.label + delta + defs.length) % defs.length }, command: null };
    }
    return { state, command: null };
  }

  const menu = menuOf(state.open, defs);
  const last = menu.items.length - 1;
  switch (event.key) {
    case 'Escape':
      return closed(state);
    case 'ArrowDown':
      return moved(state, state.active === null ? 0 : (state.active + 1) % menu.items.length);
    case 'ArrowUp':
      return moved(state, state.active === null ? last : (state.active - 1 + menu.items.length) % menu.items.length);
    case 'ArrowLeft':
      return openMenu(stepMenu(state.open, defs, -1), 0, defs);
    case 'ArrowRight':
      return openMenu(stepMenu(state.open, defs, 1), 0, defs);
    case 'Enter':
    case ' ':
    case 'Spacebar':
      if (event.repeat === true || state.active === null) return { state, command: null };
      return activate(state, menu.items[state.active].id, flags);
    default:
      return { state, command: null };
  }
}

function activate(state: MenuState, item: MenuItemId, flags: MenuFlags): MenuResult {
  // A disabled row yields nothing and keeps the menu open, like Windows.
  if (!itemEnabled(item, flags)) return { state, command: null };
  return { state: { ...INITIAL_MENU_STATE, label: state.label }, command: { type: 'activate', item } };
}

function keyUp(state: MenuState, defs: readonly MenuDef[]): MenuResult {
  // Press-and-release Alt with nothing in between toggles the bar.
  if (!state.altPending) return { state, command: null };
  return state.open === null ? openMenu(defs[0].id, 0, defs) : closed(state);
}

function stepMenu(current: MenuId, defs: readonly MenuDef[], delta: 1 | -1): MenuId {
  const index = defs.findIndex((def) => def.id === current);
  const next = (index + delta + defs.length) % defs.length;
  return defs[next].id;
}
