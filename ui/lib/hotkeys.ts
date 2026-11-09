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

export interface HotkeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

export interface HotkeyContext {
  modalOpen: boolean;
  popoverOpen?: boolean;
  /** An open menu owns the keyboard; player shortcuts stay inert. */
  menuOpen?: boolean;
}

export interface HotkeySession {
  target: unknown;
  selectEscaped: boolean;
}

export const INITIAL_SESSION: HotkeySession = { target: undefined, selectEscaped: false };

export interface HotkeyResult {
  action: HotkeyAction | null;
  session: HotkeySession;
}

const NON_TEXT_INPUT_TYPES = new Set([
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
  'color',
  'image',
]);
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

function tagNameOf(target: unknown): string {
  const tag = (target as { tagName?: unknown } | null | undefined)?.tagName;
  return typeof tag === 'string' ? tag.toUpperCase() : '';
}

function inputTypeOf(target: unknown): string {
  const type = (target as { type?: unknown } | null | undefined)?.type;
  return typeof type === 'string' ? type.toLowerCase() : '';
}

function isTextEntry(target: unknown): boolean {
  const tag = tagNameOf(target);
  if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUT_TYPES.has(inputTypeOf(target));
}

function activatesOnSpace(target: unknown): boolean {
  const tag = tagNameOf(target);
  if (ACTIVATABLE_TAGS.has(tag)) return true;
  const type = inputTypeOf(target);
  return tag === 'INPUT' && type !== 'range' && NON_TEXT_INPUT_TYPES.has(type);
}

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

  if (ctx.menuOpen === true) return null;

  if (key === 'Escape') {
    if (tag === 'SELECT' && !selectEscaped) return null;
    const overlay = closeOverlayTarget({
      modalOpen: ctx.modalOpen,
      popoverOpen: ctx.popoverOpen === true,
    });
    return overlay === 'none' ? { type: 'clearLoop' } : { type: 'closeOverlay' };
  }

  if (ctx.modalOpen) return null;

  if (ctrl && !meta && !alt && !shift && (key === 'o' || key === 'O')) {
    return event.repeat === true ? null : { type: 'openRecording' };
  }

  if (isTextEntry(event.target)) return null;
  if (ctrl || meta || alt) return null;

  const directional = key === 'ArrowLeft' || key === 'ArrowRight';
  if (event.repeat === true && !directional) return null;

  switch (key) {
    case ' ':
    case 'Spacebar':
      return activatesOnSpace(event.target) ? null : { type: 'togglePlay' };
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
