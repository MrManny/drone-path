'use client';

import { Film, Layers } from 'lucide-react';
import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { useTranslation } from '../lib/i18n.js';
import { formatTime } from '../lib/frametime.js';

export type WorkspaceMode = 'archive' | 'review';

interface WorkspaceHeaderProps {
  /** Recording length in seconds; null while no recording is loaded. */
  durationSec: number | null;
  mode?: WorkspaceMode;
  showModeSwitch?: boolean;
  onModeChange?: (mode: WorkspaceMode) => void;
}

export function WorkspaceHeader({
  durationSec,
  mode,
  showModeSwitch = false,
  onModeChange,
}: WorkspaceHeaderProps) {
  const t = useTranslation();
  const tabRefs = useRef<Record<WorkspaceMode, HTMLButtonElement | null>>({
    archive: null,
    review: null,
  });
  const modeTabs: ReadonlyArray<{
    id: WorkspaceMode;
    label: string;
    Icon: typeof Layers;
  }> = [
    { id: 'archive', label: t('workspaceHeader.archiveMode'), Icon: Layers },
    { id: 'review', label: t('workspaceHeader.reviewMode'), Icon: Film },
  ];

  const handleTabKeyDown = (current: WorkspaceMode, e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let next: WorkspaceMode | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      next = current === 'archive' ? 'review' : 'archive';
    } else if (e.key === 'Home') {
      next = 'archive';
    } else if (e.key === 'End') {
      next = 'review';
    }
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    tabRefs.current[next]?.focus();
    if (next !== mode) {
      onModeChange?.(next);
    }
  };

  return (
    <header className="workspace-header">
      <div className="brand">
        <span>drone</span>
        <span className="brand-light"> / path</span>
      </div>
      <div className="header-divider" />
      <div className="header-project">
        <h1 className="preview-title">{t('workspaceHeader.flightWorkspace')}</h1>
        {durationSec === null ? null : (
          <small>{t('workspaceHeader.recordingDuration', { duration: formatTime(durationSec) })}</small>
        )}
      </div>
      {showModeSwitch && mode && onModeChange ? (
        <div className="header-mode-tabs" role="tablist" aria-label={t('workspaceHeader.mode')}>
          {modeTabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              aria-selected={mode === id}
              tabIndex={mode === id ? 0 : -1}
              className="header-mode-tab"
              onClick={() => onModeChange(id)}
              onKeyDown={(e) => handleTabKeyDown(id, e)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
