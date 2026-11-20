'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { translator, tEnglish } from '../../src/desktop-i18n/messages.js';
import type { Locale } from '../../src/desktop-i18n/messages.js';

const TranslationContext = createContext(tEnglish);

export function LanguageProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useMemo(() => translator(locale), [locale]);
  return <TranslationContext.Provider value={t}>{children}</TranslationContext.Provider>;
}

export function useTranslation() {
  return useContext(TranslationContext);
}
