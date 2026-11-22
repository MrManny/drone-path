'use client';

import { useCallback } from 'react';

import type { RenderConfig } from 'drone-path-engine/config';
import type { UiSession } from '../../src/appsession.js';
import type { Locale } from '../../src/desktop-i18n/messages.js';
import { translator } from '../../src/desktop-i18n/messages.js';
import type { AppModals } from '../hooks/useAppModals.js';
import { aboutContent } from '../lib/abouttext.js';
import { BUILD_GIT, BUILD_VERSION } from '../lib/buildinfo/generated/buildinfo.js';
import type { LoopState } from '../lib/loop.js';
import { MANUAL } from '../lib/manual/generated/manual.js';
import { AboutDialog } from './AboutDialog.js';
import { ExportModal } from './ExportModal.js';
import { HelpOverlay } from './HelpOverlay.js';
import { MapAppearanceModal } from './MapAppearanceModal.js';
import { SettingsDialog } from './SettingsDialog.js';
import { TrackSaveModal } from './TrackSaveModal.js';
import { UpdatePrompt } from './UpdatePrompt.js';

export interface ModalHostProps {
  modals: AppModals;
  session: UiSession | null;
  settings: RenderConfig;
  loop: LoopState;
  onSettingsChange: (config: RenderConfig) => void;
  language: {
    locale: Locale;
    preference: string | null;
    saving: boolean;
    error: boolean;
    selectLanguage: (locale: Locale | null) => void;
  };
}

export function ModalHost({
  modals,
  session,
  settings,
  loop,
  onSettingsChange,
  language,
}: ModalHostProps) {
  const { dialogs, exportFlow, trackSave, update, restartUpdate } = modals;
  const { active, dismissible, dispatchDialog } = dialogs;
  const closeOverlay = useCallback(() => dispatchDialog({ type: 'close' }), [dispatchDialog]);

  switch (active) {
    case 'closed':
      return null;
    case 'map-appearance':
      return (
        <MapAppearanceModal
          session={session}
          config={settings}
          onChange={onSettingsChange}
          onClose={closeOverlay}
        />
      );
    case 'settings':
      return (
        <SettingsDialog
          preference={language.preference}
          saving={language.saving}
          error={language.error}
          onSelect={language.selectLanguage}
          onClose={closeOverlay}
        />
      );
    case 'update':
      return (
        <UpdatePrompt
          restarting={update.phase === 'restarting'}
          failure={update.failure}
          onRestart={restartUpdate}
          onLater={closeOverlay}
        />
      );
    case 'help':
      return <HelpOverlay bundle={MANUAL} onClose={closeOverlay} />;
    case 'about':
      return (
        <AboutDialog
          content={aboutContent(BUILD_VERSION, BUILD_GIT, translator(language.locale))}
          onClose={closeOverlay}
        />
      );
    case 'export':
      return session && exportFlow.state ? (
        <ExportModal
          session={session}
          settings={settings}
          loop={loop}
          state={exportFlow.state}
          dismissible={dismissible}
          onDispatch={exportFlow.dispatch}
          onStart={(segment) => exportFlow.start(settings, segment)}
          onCancel={exportFlow.cancel}
          onRunDone={exportFlow.runDone}
          onEncoderChange={(encode) => onSettingsChange({ ...settings, ...encode })}
          onClose={closeOverlay}
        />
      ) : null;
    case 'track-save':
      return trackSave.phase ? (
        <TrackSaveModal
          phase={trackSave.phase}
          dismissible={dismissible}
          onReveal={trackSave.reveal}
          onClose={closeOverlay}
        />
      ) : null;
  }
}
