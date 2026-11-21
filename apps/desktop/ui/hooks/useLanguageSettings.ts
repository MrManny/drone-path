'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_LOCALE, translator } from '../../src/desktop-i18n/messages.js';
import type { LanguageSettings, Locale } from '../../src/desktop-i18n/messages.js';
import { appBridge, tryAppBridge } from '../lib/backend.js';
import { useMountedRef } from './useMountedRef.js';

export function useLanguageSettings() {
  const [language, setLanguage] = useState<LanguageSettings>({
    locale: DEFAULT_LOCALE,
    preference: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const mountedRef = useMountedRef();
  const savingRef = useRef(false);
  const editedRef = useRef(false);

  useEffect(() => {
    void tryAppBridge()
      ?.getLanguage?.()
      .then((resolved) => {
        if (mountedRef.current && !editedRef.current) setLanguage(resolved);
      })
      .catch(() => {});
  }, [mountedRef]);

  useEffect(() => {
    document.documentElement.lang = language.locale;
    document.title = translator(language.locale)('app.title');
  }, [language.locale]);

  const selectLanguage = useCallback(async (preference: Locale | null) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(false);
    try {
      const result = await appBridge().saveLanguage(preference);
      if (!mountedRef.current) return;
      if (result.ok) {
        editedRef.current = true;
        setLanguage(result);
      } else {
        setError(true);
      }
    } catch {
      if (mountedRef.current) setError(true);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  return { ...language, saving, error, selectLanguage };
}
