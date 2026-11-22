'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { DEFAULT_CONFIG, settingsPatchOf } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import type { UiSession } from '../../shared/ipc.js';
import { EmptyWorkspace } from '../components/EmptyWorkspace.js';
import { ModalHost } from '../components/ModalHost.js';
import { PlayerChrome } from '../components/PlayerChrome.js';
import { useAppModals } from '../hooks/useAppModals.js';
import { useLanguageSettings } from '../hooks/useLanguageSettings.js';
import { appBridge, tryAppBridge } from '../lib/backend.js';
import { LanguageProvider } from '../lib/i18n.js';
import type { LoopState } from '../lib/loop.js';
import { normalizeZoom, resetZoom } from '../lib/mapzoom.js';
import { pickRecordingFlow } from '../lib/pickflow.js';
import { pickReducer } from '../lib/pickstate.js';

interface LoadedSession {
  id: number;
  value: UiSession;
}

const NO_LOOP: LoopState = { in: null, out: null };

export default function Page() {
  const [pickState, dispatch] = useReducer(pickReducer, { kind: 'idle' });
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [settings, setSettings] = useState<RenderConfig>(DEFAULT_CONFIG);
  const [loop, setLoop] = useState<LoopState>(NO_LOOP);
  const modals = useAppModals();
  const language = useLanguageSettings();
  const { dialogs, openExport, openTrackSave, resetForRecording } = modals;
  const { dispatchDialog } = dialogs;
  const nextId = useRef(0);
  const picking = useRef(false);
  const settingsVersion = useRef(0);

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
          setLoop(NO_LOOP);
          resetForRecording();
        },
      );
      dispatch(event);
      picking.current = false;
    })();
  }, [settings, resetForRecording]);

  const dismissOpen = useCallback(() => dispatch({ type: 'dismiss' }), []);
  const openHelp = useCallback(() => dispatchDialog({ type: 'openHelp' }), [dispatchDialog]);

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
          loopControl={[loop, setLoop]}
          onExportVideo={() => openExport(settings, loop, loaded.value.video.frames)}
          onExportTelemetry={openTrackSave}
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
      <ModalHost
        modals={modals}
        session={loaded?.value ?? null}
        settings={settings}
        loop={loop}
        onSettingsChange={handleSettingsChange}
        language={language}
      />
    </LanguageProvider>
  );
}
