'use client';

import { useEffect, useState } from 'react';

import { DEFAULT_LOCALE, translator } from '../../src/desktop-i18n/messages.js';
import type { LanguageSettings, Locale } from '../../src/desktop-i18n/messages.js';
import { appBridge } from '../lib/backend.js';

export function useLanguageSettings() {
  const [language, setLanguage] = useState<LanguageSettings>({
    locale: DEFAULT_LOCALE,
    preference: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let canceled = false;
    try {
      void appBridge().getLanguage?.().then((resolved) => {
        if (!canceled) setLanguage(resolved);
      }).catch(() => {});
    } catch {
      // Outside the app shell there is no backend: keep the default locale.
    }
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language.locale;
    document.title = translator(language.locale)('app.title');
  }, [language.locale]);

  async function selectLanguage(preference: Locale | null) {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      const result = await appBridge().saveLanguage(preference);
      if (result.ok) setLanguage(result);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return { ...language, saving, error, selectLanguage };
}
