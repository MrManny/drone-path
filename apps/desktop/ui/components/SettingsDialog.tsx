'use client';

import { isLocale, languageName, locales } from '../../src/desktop-i18n/messages.js';
import type { Locale } from '../../src/desktop-i18n/messages.js';
import { useTranslation } from '../lib/i18n.js';
import { DialogShell } from './DialogShell.js';
import { Notice } from './Notice.js';
import { SelectField } from './SelectField.js';

interface SettingsDialogProps {
  preference: string | null;
  saving: boolean;
  error: boolean;
  onSelect: (locale: Locale | null) => void;
  onClose: () => void;
}

export function SettingsDialog({ preference, saving, error, onSelect, onClose }: SettingsDialogProps) {
  const t = useTranslation();
  return (
    <DialogShell title={t('settings.title')} onClose={onClose}>
      <SelectField
        label={t('settings.language')}
        value={preference ?? ''}
        disabled={saving}
        options={[
          { value: '', label: t('settings.system') },
          ...locales.map((locale) => ({ value: locale, label: languageName(locale) })),
        ]}
        onValue={(value) => onSelect(isLocale(value) ? value : null)}
      />
      {error ? <Notice tone="danger">{t('settings.saveError')}</Notice> : null}
    </DialogShell>
  );
}
