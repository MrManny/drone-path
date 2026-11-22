import {
  DEFAULT_LOCALE,
  createTranslator,
  languageName,
  resolveLocaleWith,
  tEnglish,
} from './core.js';
import type { Catalog, LanguageSettings, Locale, Translate } from './core.js';
import { catalogs } from './generated/catalogs.js';

export { DEFAULT_LOCALE, languageName, tEnglish };
export type { LanguageSettings, Locale, Translate };

const messages: Readonly<Record<Locale, Catalog>> = catalogs;

export const locales = Object.keys(catalogs) as Locale[];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(catalogs, value);
}

export function resolveLocale(preference: string | null, systemLanguages: readonly string[]): Locale {
  return resolveLocaleWith(preference, systemLanguages, isLocale);
}

const translatorCache = new Map<Locale, Translate>([[DEFAULT_LOCALE, tEnglish]]);

export function translator(locale: Locale): Translate {
  const cached = translatorCache.get(locale);
  if (cached) return cached;
  const translate = createTranslator(locale, messages[locale], messages.en);
  translatorCache.set(locale, translate);
  return translate;
}
