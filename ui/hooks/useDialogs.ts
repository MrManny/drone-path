'use client';

import { useReducer } from 'react';

import type { DialogEvent } from '../lib/dialogstate.js';
import { canDismiss, dialogReducer } from '../lib/dialogstate.js';

export interface Dialogs {
  modalOpen: boolean;
  helpOpen: boolean;
  aboutOpen: boolean;
  exportOpen: boolean;
  telemetrySaveOpen: boolean;
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
    exportOpen: dialog === 'export-form' || dialog === 'export-running',
    telemetrySaveOpen: dialog === 'telemetry-save' || dialog === 'telemetry-saving',
    updateOpen: dialog === 'update-prompt',
    dismissible: canDismiss(dialog),
    dispatchDialog,
  };
}
