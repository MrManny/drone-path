'use client';

import { useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { RenderConfig } from '../../src/config.js';
import type { DialogRunEvent } from '../lib/dialogstate.js';
import type { LoopState } from '../lib/loop.js';
import { ExportModal } from './ExportModal.js';

export interface ExportHostProps {
  session: UiSession;
  settings: RenderConfig;
  loop: LoopState;
  /** Whether the dialog is open; the host stays mounted to keep the sizes. */
  open: boolean;
  /** The one dismissal rule from the dialog machine. */
  dismissible: boolean;
  onClose: () => void;
  onRunEvent: (event: DialogRunEvent) => void;
  onSettingsChange: (config: RenderConfig) => void;
}

// The export dialog's host: it remembers the session's committed output sizes
// so the form reopens on them, and ties encoder changes back into the shared
// look settings. It stays mounted across dialog opens to keep that memory.
export function ExportHost({
  session,
  settings,
  loop,
  open,
  dismissible,
  onClose,
  onRunEvent,
  onSettingsChange,
}: ExportHostProps) {
  const [sizes, setSizes] = useState<{ width: number; height: number } | null>(null);
  if (!open) return null;
  return (
    <ExportModal
      session={session}
      settings={settings}
      loop={loop}
      onClose={onClose}
      dismissible={dismissible}
      onRunEvent={onRunEvent}
      onEncoderChange={(encode) => onSettingsChange({ ...settings, ...encode })}
      initialSizes={sizes}
      onSizesChange={setSizes}
    />
  );
}
