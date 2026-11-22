import {
  DEFAULT_LOCALE,
  createTranslator,
  isLocale,
  languageName,
  locales,
  resolveLocale,
  tEnglish,
} from './core.js';
import type { LanguageSettings, Locale, Translate } from './core.js';
import { localeLoaders } from './generated/loaders.js';

export { DEFAULT_LOCALE, isLocale, languageName, locales, resolveLocale, tEnglish };
export type { LanguageSettings, Locale, Translate };

const translatorCache = new Map<Locale, Translate>([[DEFAULT_LOCALE, tEnglish]]);
const pendingLoads = new Map<Locale, Promise<Translate>>();

/** Returns a synchronous translator when the locale's catalog is already loaded. */
export function cachedTranslator(locale: Locale): Translate | null {
  return translatorCache.get(locale) ?? null;
}

/** Dynamically loads and caches a single locale's catalog on demand. */
export async function loadTranslator(locale: Locale): Promise<Translate> {
  const cached = translatorCache.get(locale);
  if (cached) return cached;
  const inflight = pendingLoads.get(locale);
  if (inflight) return inflight;
  const load = locale === DEFAULT_LOCALE ? undefined : localeLoaders[locale];
  if (!load) return tEnglish;
  const promise = load()
    .then((mod) => {
      const translate = createTranslator(locale, mod.catalog);
      translatorCache.set(locale, translate);
      return translate;
    })
    .finally(() => {
      pendingLoads.delete(locale);
    });
  pendingLoads.set(locale, promise);
  return promise;
}
