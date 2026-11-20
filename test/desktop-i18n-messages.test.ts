import { describe, expect, it, vi } from 'vitest';

import { languageName, resolveLocale, translator } from '../src/desktop-i18n/messages.js';

import type * as GeneratedCatalogs from '../src/desktop-i18n/generated/catalogs.js';

vi.mock('../src/desktop-i18n/generated/catalogs.js', async (importOriginal) => {
  const { catalogs } = await importOriginal<typeof GeneratedCatalogs>();
  return {
    catalogs: {
      en: catalogs.en,
      ja: { 'settings.language': '言語' },
      'zh-Hant': { 'settings.language': '語言' },
    },
  };
});

describe('desktop locale resolution', () => {
  it.each([
    [null, ['ja-JP', 'en-GB'], 'ja'],
    [null, ['zh-Hant-TW'], 'zh-Hant'],
    [null, ['invalid_tag', 'fr-FR', 'ja-JP'], 'ja'],
    [null, ['fr-FR'], 'en'],
    ['en', ['ja-JP'], 'en'],
    ['removed', ['ja-JP'], 'ja'],
  ] as const)('resolves %s with system languages %j to %s', (preference, system, locale) => {
    expect(resolveLocale(preference, system)).toBe(locale);
  });

  it('labels languages in their own language', () => {
    expect(languageName(resolveLocale(null, ['ja-JP']))).toBe('日本語');
  });
});

describe('desktop message translation', () => {
  const t = translator(resolveLocale(null, ['ja-JP']));

  it('reads the locale and falls back to English without rendering a key', () => {
    expect(t('settings.language')).toBe('言語');
    expect(t('settings.system')).toBe('System default');
    expect(Reflect.apply(t, undefined, ['missing.key'])).toBe('');
  });

  it('interpolates a value without interpreting placeholders in the inserted value', () => {
    expect(t('native.replaceFile', { name: '{path}.mp4' })).toBe('Replace {path}.mp4?');
  });

  it('applies the fallback language plural rules to English copy', () => {
    expect(t('cameraControls.paddingLevels', { count: 1 })).toBe('1 level');
    expect(t('cameraControls.paddingLevels', { count: 2 })).toBe('2 levels');
  });

  it('reuses the translator instance per locale', () => {
    expect(translator('en')).toBe(translator('en'));
    expect(translator(resolveLocale(null, ['ja-JP']))).toBe(t);
  });
});
