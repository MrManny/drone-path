'use client';

import { useTranslation } from '../lib/i18n.js';
import type { PickState } from '../lib/pickstate.js';
import { prepareNoticeText, preparePercent } from '../lib/preparetext.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';
import { ProgressBar } from './ProgressBar.js';

interface OpenNoticeProps {
  state: PickState;
  onDismiss?: () => void;
}

export function OpenNotice({ state, onDismiss }: OpenNoticeProps) {
  const t = useTranslation();
  switch (state.kind) {
    case 'preparing':
      return (
        <div className="prepare-status">
          <ProgressBar label={t('openNotice.preparationProgress')} percent={preparePercent(state.progress)} />
          <Notice tone="info">{prepareNoticeText(state.progress, t)}</Notice>
        </div>
      );
    case 'canceled':
      return (
        <Notice tone="info" onDismiss={onDismiss}>
          {t('openNotice.noRecordingPicked')}
        </Notice>
      );
    case 'error':
      return (
        <ErrorNotice
          message={state.message}
          lead={t('openNotice.couldNotOpenTheRecording')}
          onDismiss={onDismiss}
        />
      );
    default:
      return null;
  }
}
