'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { DEFAULT_CONFIG, settingsPatchOf } from 'drone-path-engine/config';
import type { RenderConfig } from 'drone-path-engine/config';
import type { PickResult, UiSession } from '../../shared/ipc.js';
import { ArchiveWorkspace } from '../components/ArchiveWorkspace.js';
import { EmptyWorkspace } from '../components/EmptyWorkspace.js';
import { ModalHost } from '../components/ModalHost.js';
import { PlayerChrome } from '../components/PlayerChrome.js';
import type { WorkspaceMode } from '../components/WorkspaceHeader.js';
import { useAppModals } from '../hooks/useAppModals.js';
import { useArchiveWorkspace } from '../hooks/useArchiveWorkspace.js';
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
  initialSeekSec?: number;
}

const NO_LOOP: LoopState = { in: null, out: null };

export default function Page() {
  const [pickState, dispatch] = useReducer(pickReducer, { kind: 'idle' });
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>('review');
  const [settings, setSettings] = useState<RenderConfig>(DEFAULT_CONFIG);
  const [loop, setLoop] = useState<LoopState>(NO_LOOP);
  const modals = useAppModals();
  const language = useLanguageSettings();
  const { dialogs, openExport, openTrackSave, resetForRecording } = modals;
  const { dispatchDialog } = dialogs;
  const nextId = useRef(0);
  const picking = useRef(false);
  const settingsVersion = useRef(0);
  const archive = useArchiveWorkspace(
    useCallback(() => {
      setMode((current) => (loaded === null ? 'archive' : current));
    }, [loaded]),
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

  const openWith = useCallback(
    (
      openFn: (openSettings: RenderConfig) => Promise<PickResult>,
      initialSeekSec?: number,
    ) => {
      if (picking.current) return;
      picking.current = true;
      dispatch({ type: 'pick' });
      // A freshly opened recording always prepares and opens at auto-fit zoom (#270).
      const openSettings = { ...settings, zoom: 0 };
      void (async () => {
        const event = await pickRecordingFlow(
          {
            pickRecording: () => openFn(openSettings),
            getSession: () => appBridge().getSession(),
          },
          (session) => {
            nextId.current += 1;
            setLoaded({ id: nextId.current, value: session, initialSeekSec });
            setSettings((prev) => resetZoom(prev));
            setLoop(NO_LOOP);
            setMode('review');
            resetForRecording();
          },
        );
        dispatch(event);
        picking.current = false;
      })();
    },
    [settings, resetForRecording],
  );

  const handlePick = useCallback(() => {
    openWith((openSettings) =>
      appBridge().pickRecording({ settings: settingsPatchOf(openSettings) }),
    );
  }, [openWith]);

  const handleOpenArchiveClip = useCallback(
    (clipPath: string, seekSec?: number) => {
      openWith(
        (openSettings) =>
          appBridge().openArchiveClip({
            path: clipPath,
            settings: settingsPatchOf(openSettings),
            ...(seekSec !== undefined ? { seekSec } : {}),
          }),
        seekSec,
      );
    },
    [openWith],
  );

  const handleOpenFolder = useCallback(() => {
    void (async () => {
      const added = await archive.addFolder();
      if (added) setMode('archive');
    })();
  }, [archive]);

  const dismissOpen = useCallback(() => dispatch({ type: 'dismiss' }), []);
  const openHelp = useCallback(() => dispatchDialog({ type: 'openHelp' }), [dispatchDialog]);

  // Exit closes the window through the app shell's close path, so a running
  // export still gets its confirmation prompt.
  const handleExit = useCallback(() => {
    void tryAppBridge()
      ?.closeWindow()
      .catch(() => {});
  }, []);

  const showModeSwitch = archive.roots.length > 0 || mode === 'archive';

  return (
    <LanguageProvider locale={language.locale}>
      {mode === 'archive' ? (
        <ArchiveWorkspace
          archive={archive}
          hasRecording={loaded !== null}
          openState={pickState}
          mapStyle={settings.style}
          onMapStyleChange={(style) => handleSettingsChange({ ...settings, style })}
          onOpen={handlePick}
          onOpenFolder={handleOpenFolder}
          onOpenClip={handleOpenArchiveClip}
          onHelp={openHelp}
          onExit={handleExit}
          onDismissOpenState={dismissOpen}
          mode={mode}
          showModeSwitch={showModeSwitch}
          onModeChange={setMode}
          dialogs={dialogs}
        />
      ) : loaded ? (
        <PlayerChrome
          key={loaded.id}
          session={loaded.value}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onOpen={handlePick}
          onOpenFolder={handleOpenFolder}
          onHelp={openHelp}
          onExit={handleExit}
          dialogs={dialogs}
          openState={pickState}
          onDismissOpenState={dismissOpen}
          loopControl={[loop, setLoop]}
          initialSeekSec={loaded.initialSeekSec}
          mode={mode}
          showModeSwitch={showModeSwitch}
          onModeChange={setMode}
          onExportVideo={() => openExport(settings, loop, loaded.value.video.frames)}
          onExportTelemetry={openTrackSave}
        />
      ) : (
        <EmptyWorkspace
          state={pickState}
          onPick={handlePick}
          onOpenFolder={handleOpenFolder}
          onHelp={openHelp}
          onExit={handleExit}
          onDismiss={dismissOpen}
          mode={mode}
          showModeSwitch={showModeSwitch}
          onModeChange={setMode}
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
