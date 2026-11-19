import { catalogs } from './generated/catalogs.js';

export const DEFAULT_LOCALE = 'en';
export type Locale = keyof typeof catalogs;
export type MessageKey = keyof typeof catalogs.en;
export type MessageValues = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, values?: MessageValues) => string;
export interface LanguageSettings {
  preference: string | null;
  locale: Locale;
}

type PluralMessage = Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>;
type Catalog = Readonly<Partial<Record<MessageKey, string | PluralMessage>>>;

const messages: Readonly<Record<Locale, Catalog>> = catalogs;

export const locales = Object.keys(catalogs) as Locale[];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(catalogs, value);
}

export function resolveLocale(preference: string | null, systemLanguages: readonly string[]): Locale {
  if (preference !== null && isLocale(preference)) return preference;
  for (const language of systemLanguages) {
    try {
      const locale = new Intl.Locale(language);
      const parts = locale.baseName.split('-');
      while (parts.length > 0) {
        const candidate = parts.join('-');
        if (isLocale(candidate)) return candidate;
        parts.pop();
      }
    } catch {
      // Ignore malformed tags and continue through the OS preference list.
    }
  }
  return DEFAULT_LOCALE;
}

export function languageName(locale: Locale): string {
  return new Intl.DisplayNames(locale, { type: 'language' }).of(locale) ?? locale;
}

export function translator(locale: Locale): Translate {
  const entries = messages[locale];
  const pluralRules = new Intl.PluralRules(locale);
  const englishRules = new Intl.PluralRules(DEFAULT_LOCALE);
  return (key, values = {}) => {
    const local = Object.hasOwn(entries, key) ? entries[key] : undefined;
    const message = local ?? (Object.hasOwn(messages.en, key) ? messages.en[key] : undefined);
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

export const tEnglish = translator(DEFAULT_LOCALE);
