'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { UiSession, WarmProgress, WarmRequest } from '../../src/appsession.js';
import { DEFAULT_CONFIG, settingsPatchOf } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { LandingPanel } from '../components/LandingPanel.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { PlayerChrome } from '../components/PlayerChrome.js';
import { UpdatePrompt } from '../components/UpdatePrompt.js';
import { useDialogs } from '../hooks/useDialogs.js';
import { appBridge } from '../lib/backend.js';
import type { DialogEvent } from '../lib/dialogstate.js';
import { MANUAL } from '../lib/manual/generated/manual.js';
import { pickRecordingFlow } from '../lib/pickflow.js';
import { pickReducer } from '../lib/pickstate.js';
import { mapFrameSize } from '../lib/pipstyle.js';
import { shouldPrompt, updateReducer } from '../lib/updatestate.js';

interface LoadedSession {
  id: number;
  value: UiSession;
}

export default function Page() {
  const [pickState, dispatch] = useReducer(pickReducer, { kind: 'idle' });
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  // The background pre-warm's running count; the hint reads it in the player.
  const [warm, setWarm] = useState<WarmProgress | null>(null);
  // One settings object for the panel and the export modal; seeded from the
  // resolved config the app backend hands over.
  const [settings, setSettings] = useState<RenderConfig>(DEFAULT_CONFIG);
  // The one dialog machine: the player's dialogs and the update prompt share
  // it, so the prompt can never stack onto another dialog.
  const dialogs = useDialogs();
  const { modalOpen, helpOpen, updateOpen, dispatchDialog: dispatchDialogRaw } = dialogs;
  const [updatePhase, dispatchUpdate] = useReducer(updateReducer, 'idle');
  // While the restart runs nothing may dismiss the prompt: the wrapped
  // dispatch refuses close for every caller, Escape included.
  const dispatchDialog = useCallback(
    (event: DialogEvent) => {
      if (updatePhase === 'restarting' && event.type === 'close') return;
      dispatchDialogRaw(event);
    },
    [updatePhase, dispatchDialogRaw],
  );
  const sharedDialogs = { ...dialogs, dispatchDialog };
  const nextId = useRef(0);
  // Guards re-entry for the whole Open flow, preparation included.
  const picking = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await appBridge().getSettings();
        if (!cancelled) setSettings(resolved);
      } catch {
        // Outside the app shell there is no backend: keep the defaults.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The backend reports preparation only after the picker returned a valid file,
  // so the busy status never covers the native dialog; its progress events then
  // drive the loading bar while preparation runs.
  useEffect(() => {
    let offPreparing: (() => void) | null = null;
    let offProgress: (() => void) | null = null;
    try {
      offPreparing = appBridge().onPreparing(() => dispatch({ type: 'preparing' }));
      offProgress = appBridge().onPrepareProgress((progress) =>
        dispatch({ type: 'progress', progress }),
      );
    } catch {
      // Outside the app shell there is no backend to report progress.
    }
    return () => {
      offPreparing?.();
      offProgress?.();
    };
  }, []);

  // The background tile pre-warm's running count feeds the player's hint;
  // the player re-targets the stream itself whenever the map re-plans.
  useEffect(() => {
    if (!loaded) return;
    let off: (() => void) | null = null;
    try {
      off = appBridge().onWarmProgress(setWarm);
    } catch {
      // Outside the app shell there is no background pre-warm.
    }
    return () => {
      off?.();
    };
  }, [loaded]);

  const retargetWarm = useCallback((request: WarmRequest) => {
    try {
      void appBridge()
        .retargetWarm(request)
        .catch(() => {
          // A refused pivot leaves those tiles to the on-demand fetches.
        });
    } catch {
      // Outside the app shell there is no background pre-warm.
    }
  }, []);

  // The shell announces a finished background download once per update; the
  // state query catches downloads that finished before this subscription.
  useEffect(() => {
    let offReady: (() => void) | null = null;
    let offFailed: (() => void) | null = null;
    try {
      offReady = appBridge().onUpdateReady(() => dispatchUpdate({ type: 'ready' }));
      offFailed = appBridge().onUpdateRestartFailed(() =>
        dispatchUpdate({ type: 'restartFailed' }),
      );
      void appBridge()
        .getUpdateState()
        .then((state) => {
          if (state.ready) dispatchUpdate({ type: 'ready' });
        })
        .catch(() => {
          // A missing state answer changes nothing; the event may still come.
        });
    } catch {
      // Outside the app shell there is no backend to report updates.
    }
    return () => {
      offReady?.();
      offFailed?.();
    };
  }, []);

  // The prompt waits for a quiet UI: it never opens over another dialog or an
  // export dialog pinned open by a running job.
  useEffect(() => {
    if (!shouldPrompt(updatePhase, modalOpen)) return;
    dispatchUpdate({ type: 'prompt' });
    dispatchDialog({ type: 'updateReady' });
  }, [updatePhase, modalOpen, dispatchDialog]);

  // Escape dismisses the prompt and the help overlay on the landing too,
  // where no player hotkeys run.
  useEffect(() => {
    if (!updateOpen && !helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatchDialog({ type: 'close' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [updateOpen, helpOpen, dispatchDialog]);

  const handlePick = useCallback(() => {
    if (picking.current) return;
    picking.current = true;
    dispatch({ type: 'pick' });
    void (async () => {
      const event = await pickRecordingFlow(
        {
          pickRecording: () =>
            appBridge().pickRecording({
              settings: settingsPatchOf(settings),
              frame: mapFrameSize(window.innerWidth, window.innerHeight, false),
            }),
          getSession: () => appBridge().getSession(),
        },
        (session) => {
          nextId.current += 1;
          setWarm(null);
          setLoaded({ id: nextId.current, value: session });
        },
      );
      dispatch(event);
      picking.current = false;
    })();
  }, [settings]);

  const dismissOpen = useCallback(() => dispatch({ type: 'dismiss' }), []);

  const restartUpdate = useCallback(() => {
    dispatchUpdate({ type: 'restart' });
    const failed = () => dispatchUpdate({ type: 'restartFailed' });
    try {
      void appBridge()
        .restartToUpdate()
        .then((ack) => {
          if (!ack.ok) failed();
        })
        .catch(failed);
    } catch {
      failed();
    }
  }, []);

  const postponeUpdate = useCallback(() => dispatchDialog({ type: 'close' }), [dispatchDialog]);

  const openHelp = useCallback(() => dispatchDialog({ type: 'openHelp' }), [dispatchDialog]);
  const closeOverlay = useCallback(() => dispatchDialog({ type: 'close' }), [dispatchDialog]);

  return (
    <>
      {loaded ? (
        <PlayerChrome
          key={loaded.id}
          session={loaded.value}
          settings={settings}
          onSettingsChange={setSettings}
          onOpen={handlePick}
          onHelp={openHelp}
          dialogs={sharedDialogs}
          openState={pickState}
          onDismissOpenState={dismissOpen}
          warm={warm}
          onWarmRetarget={retargetWarm}
        />
      ) : (
        <LandingPanel
          state={pickState}
          onPick={handlePick}
          onHelp={openHelp}
          onDismiss={dismissOpen}
        />
      )}
      {dialogs.updateOpen ? (
        <UpdatePrompt
          restarting={updatePhase === 'restarting'}
          onRestart={restartUpdate}
          onLater={postponeUpdate}
        />
      ) : null}
      {helpOpen ? <HelpOverlay bundle={MANUAL} onClose={closeOverlay} /> : null}
    </>
  );
}
