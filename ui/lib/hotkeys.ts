// Keyboard shortcut vocabulary for the review player as a pure key-to-action
// mapping, so every shortcut and guard rail stays unit-testable away from the
// DOM. Guard rails: shortcuts are inert while focus is in an editable control,
// Space yields to a focused button, link or disclosure, everything except Esc
// is inert while a modal overlay is open, a focused select keeps at most one
// Esc per interaction for its own dropdown, and held keys auto-repeat only for
// stepping/jumping (a repeating Space would flicker play/pause, a repeating S
// would flicker the layout).

import { closeOverlayTarget } from './overlayrouting.js';

export type HotkeyAction =
  | { type: 'togglePlay' }
  | { type: 'speed'; rate: 1 | 2 | 3 | 4 }
  | { type: 'step'; frames: -1 | 1 }
  | { type: 'jump'; seconds: -1 | 1 }
  | { type: 'seekStart' }
  | { type: 'seekEnd' }
  | { type: 'setLoopIn' }
  | { type: 'setLoopOut' }
  | { type: 'clearLoop' }
  | { type: 'swapView' }
  | { type: 'openRecording' }
  | { type: 'closeOverlay' };

/** The KeyboardEvent fields the mapping reads; real events satisfy it. */
export interface HotkeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** True while a held key auto-repeats. */
  repeat?: boolean;
  target?: unknown;
}

export interface HotkeyContext {
  /** A modal overlay is open: only Esc gets through. */
  modalOpen: boolean;
  /** The map appearance popover is open: Esc closes it, not the loop. */
  popoverOpen?: boolean;
}

/** The cross-event state a key stream threads through mapKey calls. */
export interface HotkeySession {
  /** Identity of the previous key event's target, by reference. */
  target: unknown;
  /** The previous key was an Esc while a select held focus. */
  selectEscaped: boolean;
}

export const INITIAL_SESSION: HotkeySession = { target: undefined, selectEscaped: false };

export interface HotkeyResult {
  action: HotkeyAction | null;
  /** Feed the next mapKey call to keep the Esc reservation per interaction. */
  session: HotkeySession;
}

const EDITABLE_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
// Space activates these when focused; hijacking it would steal that activation.
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

function tagNameOf(target: unknown): string {
  const tag = (target as { tagName?: unknown } | null | undefined)?.tagName;
  return typeof tag === 'string' ? tag.toUpperCase() : '';
}

/**
 * Maps one key event to its action and the session for the next event. The
 * session reserves at most one Esc per select interaction: the first Esc over
 * a focused select belongs to the select's own dropdown, every further one
 * passes through, and any other key or target change marks a fresh
 * interaction that gets a new reservation.
 */
export function mapKey(
  event: HotkeyEvent,
  ctx: HotkeyContext,
  session: HotkeySession = INITIAL_SESSION,
): HotkeyResult {
  return {
    action: mapAction(event, ctx, session.selectEscaped && event.target === session.target),
    session: {
      target: event.target,
      selectEscaped: tagNameOf(event.target) === 'SELECT' && event.key === 'Escape',
    },
  };
}

function mapAction(
  event: HotkeyEvent,
  ctx: HotkeyContext,
  selectEscaped: boolean,
): HotkeyAction | null {
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;
  const tag = tagNameOf(event.target);
  const { key } = event;

  // Esc stands apart: it closes an open overlay from anywhere and clears the
  // loop otherwise. The first Esc over a focused select is reserved for the
  // select's own dropdown; the next one closes like from anywhere else (#93).
  if (key === 'Escape') {
    if (tag === 'SELECT' && !selectEscaped) return null;
    const overlay = closeOverlayTarget({
      modalOpen: ctx.modalOpen,
      popoverOpen: ctx.popoverOpen === true,
    });
    return overlay === 'none' ? { type: 'clearLoop' } : { type: 'closeOverlay' };
  }

  if (ctx.modalOpen) return null;

  // Ctrl+O stays available while typing; plain O belongs to the loop.
  if (ctrl && !meta && !alt && !shift && (key === 'o' || key === 'O')) {
    return event.repeat === true ? null : { type: 'openRecording' };
  }

  if (EDITABLE_TAGS.has(tag)) return null;
  if (ctrl || meta || alt) return null;

  const directional = key === 'ArrowLeft' || key === 'ArrowRight';
  if (event.repeat === true && !directional) return null;

  switch (key) {
    case ' ':
    case 'Spacebar':
      return ACTIVATABLE_TAGS.has(tag) ? null : { type: 'togglePlay' };
    case 'k':
    case 'K':
      return { type: 'togglePlay' };
    case '1':
      return { type: 'speed', rate: 1 };
    case '2':
      return { type: 'speed', rate: 2 };
    case '3':
      return { type: 'speed', rate: 3 };
    case '4':
      return { type: 'speed', rate: 4 };
    case 'Home':
      return { type: 'seekStart' };
    case 'End':
      return { type: 'seekEnd' };
    case 'i':
    case 'I':
      return { type: 'setLoopIn' };
    case 'o':
    case 'O':
      return { type: 'setLoopOut' };
    case 's':
    case 'S':
      return { type: 'swapView' };
    case 'ArrowLeft':
      return shift ? { type: 'jump', seconds: -1 } : { type: 'step', frames: -1 };
    case 'ArrowRight':
      return shift ? { type: 'jump', seconds: 1 } : { type: 'step', frames: 1 };
    default:
      return null;
  }
}
