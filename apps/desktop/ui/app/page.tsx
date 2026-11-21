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
import { appBridge, tryAppBridge } from '../lib/backend.js';
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
  const restarting = useRef(false);

  const handleRestartFailed = useCallback(
    (message: string) => {
      if (!restarting.current) return;
      restarting.current = false;
      dispatchUpdate({ type: 'restartFailed', message });
      dispatchDialog({ type: 'runFinished' });
    },
    [dispatchDialog],
  );

  useEffect(() => {
    const bridge = tryAppBridge();
    if (!bridge) return;
    let cancelled = false;
    const version = settingsVersion.current;
    void (async () => {
      try {
        const resolved = await bridge.getSettings();
        // Stored settings may predate the Zoom field rule (#271).
        if (!cancelled && settingsVersion.current === version) {
          setSettings(normalizeZoom(resolved));
        }
      } catch {
        // Keep defaults if loading settings fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSettingsChange = useCallback((next: RenderConfig) => {
    settingsVersion.current += 1;
    setSettings(next);
    void tryAppBridge()
      ?.saveSettings(settingsPatchOf(next))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const bridge = tryAppBridge();
    if (!bridge) return;
    const offPreparing = bridge.onPreparing?.(() => dispatch({ type: 'preparing' }));
    const offProgress = bridge.onPrepareProgress?.((progress) =>
      dispatch({ type: 'progress', progress }),
    );
    return () => {
      offPreparing?.();
      offProgress?.();
    };
  }, []);

  useEffect(() => {
    const bridge = tryAppBridge();
    if (!bridge) return;
    const offReady = bridge.onUpdateReady?.(() => dispatchUpdate({ type: 'ready' }));
    const offFailed = bridge.onUpdateRestartFailed?.(handleRestartFailed);
    void bridge
      .getUpdateState?.()
      .then((state) => {
        if (state.ready) dispatchUpdate({ type: 'ready' });
      })
      .catch(() => {});
    return () => {
      offReady?.();
      offFailed?.();
    };
  }, [handleRestartFailed]);

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
    restarting.current = true;
    dispatchUpdate({ type: 'restart' });
    dispatchDialog({ type: 'runStarted' });
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
  }, [dispatchDialog, handleRestartFailed]);

  const openHelp = useCallback(() => dispatchDialog({ type: 'openHelp' }), [dispatchDialog]);
  const closeOverlay = useCallback(() => dispatchDialog({ type: 'close' }), [dispatchDialog]);

  // Exit closes the window through the app shell's close path, so a running
  // export still gets its confirmation prompt.
  const handleExit = useCallback(() => {
    void tryAppBridge()
      ?.closeWindow()
      .catch(() => {});
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
          onLater={closeOverlay}
        />
      ) : null}
      {helpOpen ? <HelpOverlay bundle={MANUAL} onClose={closeOverlay} /> : null}
      {dialogs.aboutOpen ? (
        <AboutDialog content={aboutContent(BUILD_VERSION, BUILD_GIT, translator(language.locale))} onClose={closeOverlay} />
      ) : null}
    </LanguageProvider>
  );
}
