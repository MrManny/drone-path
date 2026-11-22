import { LOCALES, englishCatalog } from './generated/en.js';

export const DEFAULT_LOCALE = 'en' as const;
export type Locale = (typeof LOCALES)[number];
type MessageKey = keyof typeof englishCatalog;
type MessageValues = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, values?: MessageValues) => string;
export interface LanguageSettings {
  preference: string | null;
  locale: Locale;
}

export type PluralMessage = Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>;
export type Catalog = Readonly<Partial<Record<MessageKey, string | PluralMessage>>>;

export const locales: readonly Locale[] = LOCALES;

const localeSet = new Set<string>(LOCALES);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && localeSet.has(value);
}

/** Resolves the first matching locale using the caller-supplied membership check. */
export function resolveLocaleWith(
  preference: string | null,
  systemLanguages: readonly string[],
  isSupported: (candidate: string) => candidate is Locale,
): Locale {
  if (preference !== null && isSupported(preference)) return preference;
  for (const language of systemLanguages) {
    try {
      const locale = new Intl.Locale(language);
      const parts = locale.baseName.split('-');
      while (parts.length > 0) {
        const candidate = parts.join('-');
        if (isSupported(candidate)) return candidate;
        parts.pop();
      }
    } catch {
      // Ignore malformed tags and continue through the OS preference list.
    }
  }
  return DEFAULT_LOCALE;
}

export function resolveLocale(preference: string | null, systemLanguages: readonly string[]): Locale {
  return resolveLocaleWith(preference, systemLanguages, isLocale);
}

export function languageName(locale: Locale): string {
  return new Intl.DisplayNames(locale, { type: 'language' }).of(locale) ?? locale;
}

const englishRules = new Intl.PluralRules(DEFAULT_LOCALE);

/** Builds a message translator for one locale with English fallback. */
export function createTranslator(
  locale: Locale,
  entries: Catalog,
  fallback: Catalog = englishCatalog,
): Translate {
  const pluralRules = locale === DEFAULT_LOCALE ? englishRules : new Intl.PluralRules(locale);
  return (key, values = {}) => {
    const local = Object.hasOwn(entries, key) ? entries[key] : undefined;
    const message = local ?? (Object.hasOwn(fallback, key) ? fallback[key] : undefined);
    if (message === undefined) return '';
    const rules = local === undefined ? englishRules : pluralRules;
    const template = typeof message === 'string'
      ? message
      : message[rules.select(Number(values.count))] ?? message.other;
    return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : '',
    );
  };
}

export const tEnglish = createTranslator(DEFAULT_LOCALE, englishCatalog);
