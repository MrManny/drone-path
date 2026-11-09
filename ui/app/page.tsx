'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG, settingsPatchOf } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { AboutDialog } from '../components/AboutDialog.js';
import { EmptyWorkspace } from '../components/EmptyWorkspace.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { PlayerChrome } from '../components/PlayerChrome.js';
import { UpdatePrompt } from '../components/UpdatePrompt.js';
import { useDialogs } from '../hooks/useDialogs.js';
import { aboutContent } from '../lib/abouttext.js';
import { appBridge } from '../lib/backend.js';
import { BUILD_GIT, BUILD_VERSION } from '../lib/buildinfo/generated/buildinfo.js';
import type { DialogEvent } from '../lib/dialogstate.js';
import { MANUAL } from '../lib/manual/generated/manual.js';
import { pickRecordingFlow } from '../lib/pickflow.js';
import { pickReducer } from '../lib/pickstate.js';
import { shouldPrompt, updateReducer } from '../lib/updatestate.js';

interface LoadedSession {
  id: number;
  value: UiSession;
}

export default function Page() {
  const [pickState, dispatch] = useReducer(pickReducer, { kind: 'idle' });
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [settings, setSettings] = useState<RenderConfig>(DEFAULT_CONFIG);
  const dialogs = useDialogs();
  const { modalOpen, helpOpen, dispatchDialog: dispatchDialogRaw } = dialogs;
  const [updatePhase, dispatchUpdate] = useReducer(updateReducer, 'idle');
  const dispatchDialog = useCallback(
    (event: DialogEvent) => {
      if (updatePhase === 'restarting' && event.type === 'close') return;
      dispatchDialogRaw(event);
    },
    [updatePhase, dispatchDialogRaw],
  );
  const sharedDialogs = { ...dialogs, dispatchDialog };
  const nextId = useRef(0);
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

  const handleSettingsChange = useCallback((next: RenderConfig) => {
    setSettings(next);
    try {
      void appBridge()
        .saveSettings(settingsPatchOf(next))
        .catch(() => {
        });
    } catch {
      // Outside the app shell there is no backend to persist settings.
    }
  }, []);

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
        });
    } catch {
      // Outside the app shell there is no backend to report updates.
    }
    return () => {
      offReady?.();
      offFailed?.();
    };
  }, []);

  useEffect(() => {
    if (!shouldPrompt(updatePhase, modalOpen)) return;
    dispatchUpdate({ type: 'prompt' });
    dispatchDialog({ type: 'updateReady' });
  }, [updatePhase, modalOpen, dispatchDialog]);

  const handlePick = useCallback(() => {
    if (picking.current) return;
    picking.current = true;
    dispatch({ type: 'pick' });
    void (async () => {
      const event = await pickRecordingFlow(
        {
          pickRecording: () =>
            appBridge().pickRecording({ settings: settingsPatchOf(settings) }),
          getSession: () => appBridge().getSession(),
        },
        (session) => {
          nextId.current += 1;
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

  // Exit closes the window through the app shell's close path, so a running
  // export still gets its confirmation prompt.
  const handleExit = useCallback(() => {
    try {
      void appBridge()
        .closeWindow()
        .catch(() => {});
    } catch {
      // Outside the app shell there is no window to close.
    }
  }, []);

  return (
    <>
      {loaded ? (
        <PlayerChrome
          key={loaded.id}
          session={loaded.value}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onOpen={handlePick}
          onHelp={openHelp}
          onExit={handleExit}
          dialogs={sharedDialogs}
          openState={pickState}
          onDismissOpenState={dismissOpen}
        />
      ) : (
        <EmptyWorkspace
          state={pickState}
          onPick={handlePick}
          onHelp={openHelp}
          onExit={handleExit}
          onDismiss={dismissOpen}
          dialogs={sharedDialogs}
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
      {dialogs.aboutOpen ? (
        <AboutDialog content={aboutContent(BUILD_VERSION, BUILD_GIT)} onClose={closeOverlay} />
      ) : null}
    </>
  );
}
