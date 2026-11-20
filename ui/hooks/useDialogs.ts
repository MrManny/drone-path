'use client';

import { useReducer } from 'react';

import type { DialogEvent } from '../lib/dialogstate.js';
import { canDismiss, dialogReducer } from '../lib/dialogstate.js';

export interface Dialogs {
  modalOpen: boolean;
  helpOpen: boolean;
  aboutOpen: boolean;
  mapAppearanceOpen: boolean;
  settingsOpen: boolean;
  exportOpen: boolean;
  trackSaveOpen: boolean;
  updateOpen: boolean;
  dismissible: boolean;
  dispatchDialog: (event: DialogEvent) => void;
}

export function useDialogs(): Dialogs {
  const [dialog, dispatchDialog] = useReducer(dialogReducer, 'closed');
  return {
    modalOpen: dialog !== 'closed',
    helpOpen: dialog === 'help',
    aboutOpen: dialog === 'about',
    mapAppearanceOpen: dialog === 'map-appearance',
    settingsOpen: dialog === 'settings',
    exportOpen: dialog === 'export-form' || dialog === 'export-running',
    trackSaveOpen: dialog === 'track-save' || dialog === 'track-saving',
    updateOpen: dialog === 'update-prompt' || dialog === 'update-restarting',
    dismissible: canDismiss(dialog),
    dispatchDialog,
  };
}
