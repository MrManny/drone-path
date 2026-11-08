// One rule for what the close-overlay action closes: a modal dialog above an
// open popover, the popover otherwise, and nothing when neither is open —
// the key mapper turns that case into the loop clear instead.

export interface OverlayState {
  /** A modal dialog (export, help, update) is open. */
  modalOpen: boolean;
  /** The map appearance popover is open. */
  popoverOpen: boolean;
}

export type OverlayTarget = 'modal' | 'popover' | 'none';

export function closeOverlayTarget({ modalOpen, popoverOpen }: OverlayState): OverlayTarget {
  if (modalOpen) return 'modal';
  if (popoverOpen) return 'popover';
  return 'none';
}
