import type { Translate } from '../../shared/desktop-i18n/loader.js';

export function formatArchiveDistance(
  distanceM: number | null | undefined,
  t: Translate,
): string {
  if (distanceM === null || distanceM === undefined || !Number.isFinite(distanceM)) return '--';
  if (distanceM >= 1000) {
    return t('archiveWorkspace.distanceKilometers', { value: (distanceM / 1000).toFixed(1) });
  }
  return t('archiveWorkspace.distanceMeters', { value: Math.round(distanceM) });
}
