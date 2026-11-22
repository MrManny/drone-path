'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { cachedTranslator, loadTranslator, tEnglish } from '../../shared/desktop-i18n/loader.js';
import type { Locale, Translate } from '../../shared/desktop-i18n/loader.js';

const TranslationContext = createContext<Translate>(tEnglish);

export function LanguageProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [loaded, setLoaded] = useState<{ locale: Locale; t: Translate } | null>(null);

  useEffect(() => {
    if (cachedTranslator(locale)) return;
    let cancelled = false;
    void loadTranslator(locale).then((t) => {
      if (!cancelled) setLoaded({ locale, t });
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const value = cachedTranslator(locale) ?? (loaded?.locale === locale ? loaded.t : tEnglish);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useTranslation() {
  return useContext(TranslationContext);
}
