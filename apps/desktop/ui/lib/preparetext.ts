import { tEnglish } from '../../src/desktop-i18n/messages.js';
import type { Translate } from '../../src/desktop-i18n/messages.js';
import type { PrepareProgress } from 'drone-path-engine/pipeline';

export function prepareNoticeText(progress: PrepareProgress, t: Translate = tEnglish): string {
  switch (progress.stage) {
    case 'probe':
      return t('preparetext.probe');
    case 'telemetry':
      return t('preparetext.telemetry');
    case 'plan':
      return t('preparetext.plan');
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function preparePercent(progress: PrepareProgress): number {
  return Math.round(
    100 * clamp01(progress.total > 0 ? progress.done / progress.total : 0),
  );
}
