'use client';

import { useTranslation } from '../lib/i18n.js';
import type { PickState } from '../lib/pickstate.js';
import { FolderOpen } from 'lucide-react';
import { MapCard } from './MapCard.js';
import { OpenNotice } from './OpenNotice.js';

interface EmptyStageProps {
  state: PickState;
  onPick: () => void;
  onDismiss?: () => void;
}

export function EmptyStage({ state, onPick, onDismiss }: EmptyStageProps) {
  const t = useTranslation();
  const preparing = state.kind === 'preparing';
  const notice =
    state.kind === 'preparing' || state.kind === 'canceled' || state.kind === 'error' ? (
      <OpenNotice state={state} onDismiss={onDismiss} />
    ) : null;
  return (
    <div className="stage stage-split">
      <div className="pane-video">
        <div className="stage-empty">
          <button type="button" className="primary" onClick={onPick} disabled={preparing}>
            <FolderOpen size={16} />
            {preparing ? t('emptyStage.preparing') : t('emptyStage.open')}
          </button>
          {notice}
          <p>
            {t('emptyStage.prompt')}
          </p>
        </div>
      </div>
      <MapCard data={null} layout="split" />
    </div>
  );
}
