import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  deCalls: 0,
  frCalls: 0,
  failNextDe: false,
}));

vi.mock('../shared/desktop-i18n/generated/loaders.js', () => ({
  localeLoaders: {
    de: async () => {
      state.deCalls += 1;
      if (state.failNextDe) {
        state.failNextDe = false;
        throw new Error('chunk load failed');
      }
      return { catalog: { 'app.title': 'Deutscher Titel' } };
    },
    fr: async () => {
      state.frCalls += 1;
      return { catalog: { 'app.title': 'Titre français' } };
    },
  },
}));

describe('desktop per-locale dynamic loader', () => {
  beforeEach(() => {
    vi.resetModules();
    state.deCalls = 0;
    state.frCalls = 0;
    state.failNextDe = false;
  });

  it('provides English synchronously without invoking async locale loaders', async () => {
    const { cachedTranslator, loadTranslator, tEnglish } = await import(
      '../shared/desktop-i18n/loader.js'
    );
    expect(cachedTranslator('en')).toBe(tEnglish);
    expect(cachedTranslator('de')).toBeNull();
    expect(await loadTranslator('en')).toBe(tEnglish);
    expect(state.deCalls).toBe(0);
    expect(state.frCalls).toBe(0);
  });

  it('loads only the requested locale once and deduplicates concurrent requests', async () => {
    const { cachedTranslator, loadTranslator } = await import(
      '../shared/desktop-i18n/loader.js'
    );
    const [first, second] = await Promise.all([loadTranslator('de'), loadTranslator('de')]);
    expect(first).toBe(second);
    expect(state.deCalls).toBe(1);
    expect(state.frCalls).toBe(0);
    expect(cachedTranslator('de')).toBe(first);
    expect(first('app.title')).toBe('Deutscher Titel');
    expect(first('settings.system')).toBe('System default');
  });

  it('clears failed loads so a subsequent request can retry and succeed', async () => {
    state.failNextDe = true;
    const { cachedTranslator, loadTranslator } = await import(
      '../shared/desktop-i18n/loader.js'
    );
    await expect(loadTranslator('de')).rejects.toThrow('chunk load failed');
    expect(cachedTranslator('de')).toBeNull();

    const recovered = await loadTranslator('de');
    expect(state.deCalls).toBe(2);
    expect(recovered('app.title')).toBe('Deutscher Titel');
  });

  it('falls back to English when given an unknown locale at runtime', async () => {
    const { loadTranslator, tEnglish } = await import('../shared/desktop-i18n/loader.js');
    const fallback = await loadTranslator('xx' as never);
    expect(fallback).toBe(tEnglish);
  });
});
