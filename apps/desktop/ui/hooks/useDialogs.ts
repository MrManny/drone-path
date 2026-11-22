'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { DialogEvent, DialogId } from '../lib/dialogstate.js';
import { dialogReducer } from '../lib/dialogstate.js';

export interface Dialogs {
  active: DialogId;
  modalOpen: boolean;
  dismissible: boolean;
  dispatchDialog: (event: DialogEvent) => void;
}

export function useDialogs(isBusy: (active: DialogId) => boolean = () => false): Dialogs {
  const [active, setActive] = useState<DialogId>('closed');
  const isBusyRef = useRef(isBusy);
  useLayoutEffect(() => {
    isBusyRef.current = isBusy;
  });

  const dispatchDialog = useCallback((event: DialogEvent) => {
    setActive((prev) => dialogReducer(prev, event, isBusyRef.current(prev)));
  }, []);

  return {
    active,
    modalOpen: active !== 'closed',
    dismissible: !isBusy(active),
    dispatchDialog,
  };
}
