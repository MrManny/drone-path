export interface OverlayState {
  modalOpen: boolean;
  popoverOpen: boolean;
}

export type OverlayTarget = 'modal' | 'popover' | 'none';

export function closeOverlayTarget({ modalOpen, popoverOpen }: OverlayState): OverlayTarget {
  if (modalOpen) return 'modal';
  if (popoverOpen) return 'popover';
  return 'none';
}
