'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';

import type { FrameRange } from 'drone-path-core/frame-range';
import { ERR_UNKNOWN, errorMessage } from 'drone-path-core/errors';
import type { RenderConfig } from 'drone-path-engine/config';
import { appBridge, tryAppBridge } from '../lib/backend.js';
import type { DialogEvent, DialogId } from '../lib/dialogstate.js';
import { isPlayerDialog } from '../lib/dialogstate.js';
import type { LoopState } from '../lib/loop.js';
import type { UpdatePhase, UpdateState } from '../lib/updatestate.js';
import { INITIAL_UPDATE, updateReducer } from '../lib/updatestate.js';
import type { Dialogs } from './useDialogs.js';
import { useDialogs } from './useDialogs.js';
import type { ExportController } from './useExport.js';
import { useExport } from './useExport.js';
import type { TrackSaveController } from './useTrackSave.js';
import { useTrackSave } from './useTrackSave.js';

export interface AppModals {
  dialogs: Dialogs;
  exportFlow: ExportController;
  trackSave: TrackSaveController;
  update: UpdateState;
  openExport: (settings: RenderConfig, loop: LoopState, frames: number) => void;
  openTrackSave: (range: FrameRange | null, scope: string) => void;
  restartUpdate: () => void;
  resetForRecording: () => void;
}

export function useAppModals(): AppModals {
  const exportFlow = useExport();
  const [update, dispatchUpdate] = useReducer(updateReducer, INITIAL_UPDATE);
  const restartingRef = useRef(false);
  const rawDispatchRef = useRef<(event: DialogEvent) => void>(() => {});
  const activeRef = useRef<DialogId>('closed');
  const exportClose = exportFlow.close;
  const exportReset = exportFlow.reset;
  const exportOpen = exportFlow.open;

  const onTrackSaveOpen = useCallback(() => {
    if (activeRef.current === 'export') exportClose();
    rawDispatchRef.current({ type: 'openTrackSave' });
  }, [exportClose]);

  const trackSave = useTrackSave({ onOpen: onTrackSaveOpen });
  const trackSaveSave = trackSave.save;
  const trackSaveReset = trackSave.reset;

  const isBusy = (active: DialogId): boolean =>
    (active === 'export' && exportFlow.busy) ||
    (active === 'track-save' && trackSave.busy) ||
    (active === 'update' && update.phase === 'restarting');

  const rawDialogs = useDialogs(isBusy);
  const rawDispatchDialog = rawDialogs.dispatchDialog;

  const updatePhaseRef = useRef<UpdatePhase>(update.phase);
  const isBusyRef = useRef(isBusy);
  useLayoutEffect(() => {
    rawDispatchRef.current = rawDispatchDialog;
    activeRef.current = rawDialogs.active;
    updatePhaseRef.current = update.phase;
    isBusyRef.current = isBusy;
  });

  const promptReadyUpdate = useCallback((): void => {
    if (updatePhaseRef.current !== 'ready') return;
    updatePhaseRef.current = 'prompted';
    dispatchUpdate({ type: 'prompt' });
    rawDispatchDialog({ type: 'updateReady' });
  }, [rawDispatchDialog]);

  const notifyUpdateReady = useCallback((): void => {
    if (updatePhaseRef.current !== 'idle') return;
    if (activeRef.current === 'closed') {
      updatePhaseRef.current = 'prompted';
      dispatchUpdate({ type: 'ready' });
      dispatchUpdate({ type: 'prompt' });
      rawDispatchDialog({ type: 'updateReady' });
    } else {
      updatePhaseRef.current = 'ready';
      dispatchUpdate({ type: 'ready' });
    }
  }, [rawDispatchDialog]);

  const handleRestartFailed = useCallback((message: string): void => {
    if (!restartingRef.current) return;
    restartingRef.current = false;
    dispatchUpdate({ type: 'restartFailed', message });
  }, []);

  useEffect(() => {
    const bridge = tryAppBridge();
    if (!bridge) return;
    const offReady = bridge.onUpdateReady?.(notifyUpdateReady);
    const offFailed = bridge.onUpdateRestartFailed?.(handleRestartFailed);
    void bridge
      .getUpdateState?.()
      .then((state) => {
        if (state.ready) notifyUpdateReady();
      })
      .catch(() => {});
    return () => {
      offReady?.();
      offFailed?.();
    };
  }, [notifyUpdateReady, handleRestartFailed]);

  const dispatchDialog = useCallback(
    (event: DialogEvent): void => {
      const active = activeRef.current;
      const busy = isBusyRef.current(active);
      if (event.type === 'close') {
        if (busy) return;
        if (active === 'export') exportClose();
        if (active === 'track-save') trackSaveReset();
        rawDispatchDialog(event);
        if (active !== 'update') promptReadyUpdate();
        return;
      }
      if (event.type === 'resetPlayerDialogs') {
        if (!isPlayerDialog(active)) return;
        rawDispatchDialog(event);
        promptReadyUpdate();
        return;
      }
      if (busy || active === 'update') return;
      if (active === 'export' && event.type !== 'openExport') exportClose();
      if (active === 'track-save' && event.type !== 'openTrackSave') trackSaveReset();
      rawDispatchDialog(event);
    },
    [rawDispatchDialog, exportClose, trackSaveReset, promptReadyUpdate],
  );

  const openExport = useCallback(
    (settings: RenderConfig, loop: LoopState, frames: number): void => {
      const active = activeRef.current;
      if (isBusyRef.current(active) || active === 'update') return;
      if (active === 'track-save') trackSaveReset();
      exportOpen(settings, loop, frames);
      rawDispatchDialog({ type: 'openExport' });
    },
    [exportOpen, trackSaveReset, rawDispatchDialog],
  );

  const openTrackSave = useCallback(
    (range: FrameRange | null, scope: string): void => {
      const active = activeRef.current;
      if (isBusyRef.current(active) || active === 'update') return;
      trackSaveSave(range, scope);
    },
    [trackSaveSave],
  );

  const restartUpdate = useCallback((): void => {
    restartingRef.current = true;
    dispatchUpdate({ type: 'restart' });
    try {
      void appBridge()
        .restartToUpdate()
        .then((ack) => {
          if (!ack.ok) handleRestartFailed(ack.error ?? ERR_UNKNOWN);
        })
        .catch((e) => handleRestartFailed(errorMessage(e)));
    } catch {
      handleRestartFailed(ERR_UNKNOWN);
    }
  }, [handleRestartFailed]);

  const resetForRecording = useCallback((): void => {
    exportReset();
    trackSaveReset();
    dispatchDialog({ type: 'resetPlayerDialogs' });
  }, [exportReset, trackSaveReset, dispatchDialog]);

  const dialogs = useMemo<Dialogs>(
    () => ({
      active: rawDialogs.active,
      modalOpen: rawDialogs.modalOpen,
      dismissible: rawDialogs.dismissible,
      dispatchDialog,
    }),
    [rawDialogs.active, rawDialogs.modalOpen, rawDialogs.dismissible, dispatchDialog],
  );

  return {
    dialogs,
    exportFlow,
    trackSave,
    update,
    openExport,
    openTrackSave,
    restartUpdate,
    resetForRecording,
  };
}
