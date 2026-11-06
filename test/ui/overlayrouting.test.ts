import { describe, expect, it } from 'vitest';

import { closeOverlayTarget } from '../../ui/lib/overlayrouting.js';

describe('closeOverlayTarget', () => {
  it.for([
    {
      name: 'a modal above an open popover closes the modal first',
      state: { modalOpen: true, popoverOpen: true },
      want: 'modal' as const,
    },
    {
      name: 'a modal alone closes the modal',
      state: { modalOpen: true, popoverOpen: false },
      want: 'modal' as const,
    },
    {
      name: 'the popover alone closes the popover',
      state: { modalOpen: false, popoverOpen: true },
      want: 'popover' as const,
    },
    {
      name: 'neither open leaves the action with nothing to close',
      state: { modalOpen: false, popoverOpen: false },
      want: 'none' as const,
    },
  ])('$name', ({ state, want }) => {
    expect(closeOverlayTarget(state)).toBe(want);
  });
});
