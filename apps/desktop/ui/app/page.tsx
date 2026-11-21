'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { translator } from '../../src/desktop-i18n/messages.js';
import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG, settingsPatchOf } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import { AboutDialog } from '../components/AboutDialog.js';
import { EmptyWorkspace } from '../components/EmptyWorkspace.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { MapAppearanceModal } from '../components/MapAppearanceModal.js';
import { PlayerChrome } from '../components/PlayerChrome.js';
import { SettingsDialog } from '../components/SettingsDialog.js';
import { UpdatePrompt } from '../components/UpdatePrompt.js';
import { useLanguageSettings } from '../hooks/useLanguageSettings.js';
import { LanguageProvider } from '../lib/i18n.js';
import { useDialogs } from '../hooks/useDialogs.js';
import { aboutContent } from '../lib/abouttext.js';
import { appBridge } from '../lib/backend.js';
import { BUILD_GIT, BUILD_VERSION } from '../lib/buildinfo/generated/buildinfo.js';
import { MANUAL } from '../lib/manual/generated/manual.js';
import { normalizeZoom, resetZoom } from '../lib/mapzoom.js';
import { pickRecordingFlow } from '../lib/pickflow.js';
import { pickReducer } from '../lib/pickstate.js';
import { INITIAL_UPDATE, shouldPrompt, updateReducer } from '../lib/updatestate.js';
import { ERR_UNKNOWN, errorMessage } from 'drone-path-core/errors';

interface LoadedSession {
  id: number;
  value: UiSession;
}

export default function Page() {
  const [pickState, dispatch] = useReducer(pickReducer, { kind: 'idle' });
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [settings, setSettings] = useState<RenderConfig>(DEFAULT_CONFIG);
  const dialogs = useDialogs();
  const language = useLanguageSettings();
  const { modalOpen, helpOpen, dispatchDialog } = dialogs;
  const [update, dispatchUpdate] = useReducer(updateReducer, INITIAL_UPDATE);
  const { phase: updatePhase, failure: updateFailure } = update;
  const nextId = useRef(0);
  const picking = useRef(false);
  const settingsVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const version = settingsVersion.current;
    void (async () => {
      try {
        const resolved = await appBridge().getSettings();
        // Stored settings may predate the Zoom field rule (#271).
        if (!cancelled && settingsVersion.current === version) {
          setSettings(normalizeZoom(resolved));
        }
      } catch {
        // Outside the app shell there is no backend: keep the defaults.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSettingsChange = useCallback((next: RenderConfig) => {
    settingsVersion.current += 1;
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
      offFailed = appBridge().onUpdateRestartFailed((message) => {
        dispatchUpdate({ type: 'restartFailed', message });
        dispatchDialog({ type: 'runFinished' });
      });
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
  }, [dispatchDialog]);

  useEffect(() => {
    if (!shouldPrompt(updatePhase, modalOpen)) return;
    dispatchUpdate({ type: 'prompt' });
    dispatchDialog({ type: 'updateReady' });
  }, [updatePhase, modalOpen, dispatchDialog]);

  const handlePick = useCallback(() => {
    if (picking.current) return;
    picking.current = true;
    dispatch({ type: 'pick' });
    // A freshly opened recording always prepares and opens at auto-fit zoom (#270).
    const openSettings = { ...settings, zoom: 0 };
    void (async () => {
      const event = await pickRecordingFlow(
        {
          pickRecording: () =>
            appBridge().pickRecording({ settings: settingsPatchOf(openSettings) }),
          getSession: () => appBridge().getSession(),
        },
        (session) => {
          nextId.current += 1;
          setLoaded({ id: nextId.current, value: session });
          setSettings((prev) => resetZoom(prev));
        },
      );
      dispatch(event);
      picking.current = false;
    })();
  }, [settings]);

  const dismissOpen = useCallback(() => dispatch({ type: 'dismiss' }), []);

  const restartUpdate = useCallback(() => {
    dispatchUpdate({ type: 'restart' });
    dispatchDialog({ type: 'runStarted' });
    const failed = (message: string) => {
      dispatchUpdate({ type: 'restartFailed', message });
      dispatchDialog({ type: 'runFinished' });
    };
    try {
      void appBridge()
        .restartToUpdate()
        .then((ack) => {
          if (!ack.ok) failed(ack.error ?? ERR_UNKNOWN);
        })
        .catch((e) => failed(errorMessage(e)));
    } catch {
      failed(ERR_UNKNOWN);
    }
  }, [dispatchDialog]);

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
    <LanguageProvider locale={language.locale}>
      {loaded ? (
        <PlayerChrome
          key={loaded.id}
          session={loaded.value}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onOpen={handlePick}
          onHelp={openHelp}
          onExit={handleExit}
          dialogs={dialogs}
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
          dialogs={dialogs}
        />
      )}
      {dialogs.mapAppearanceOpen ? (
        <MapAppearanceModal
          session={loaded?.value ?? null}
          config={settings}
          onChange={handleSettingsChange}
          onClose={closeOverlay}
        />
      ) : null}
      {dialogs.settingsOpen ? (
        <SettingsDialog
          preference={language.preference}
          saving={language.saving}
          error={language.error}
          onSelect={language.selectLanguage}
          onClose={closeOverlay}
        />
      ) : null}
      {dialogs.updateOpen ? (
        <UpdatePrompt
          restarting={updatePhase === 'restarting'}
          failure={updateFailure}
          onRestart={restartUpdate}
          onLater={postponeUpdate}
        />
      ) : null}
      {helpOpen ? <HelpOverlay bundle={MANUAL} onClose={closeOverlay} /> : null}
      {dialogs.aboutOpen ? (
        <AboutDialog content={aboutContent(BUILD_VERSION, BUILD_GIT, translator(language.locale))} onClose={closeOverlay} />
      ) : null}
    </LanguageProvider>
  );
}
