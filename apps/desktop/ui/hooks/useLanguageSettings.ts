'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_LOCALE, cachedTranslator, loadTranslator } from '../../shared/desktop-i18n/loader.js';
import type { LanguageSettings, Locale } from '../../shared/desktop-i18n/loader.js';
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
    let cancelled = false;
    void tryAppBridge()
      ?.getLanguage?.()
      .then(async (resolved) => {
        if (cancelled || !mountedRef.current || editedRef.current) return;
        await loadTranslator(resolved.locale).catch(() => {});
        if (!cancelled && mountedRef.current && !editedRef.current) {
          setLanguage(resolved);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mountedRef]);

  useEffect(() => {
    let cancelled = false;
    document.documentElement.lang = language.locale;
    const cached = cachedTranslator(language.locale);
    if (cached) {
      document.title = cached('app.title');
      return;
    }
    void loadTranslator(language.locale)
      .then((t) => {
        if (!cancelled) document.title = t('app.title');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
        await loadTranslator(result.locale);
        if (!mountedRef.current) return;
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
  }, [mountedRef]);

  return { ...language, saving, error, selectLanguage };
}
