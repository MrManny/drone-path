// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LanguageSettings, Locale } from '../../src/desktop-i18n/messages.js';
import { useLanguageSettings } from '../../ui/hooks/useLanguageSettings.js';

type LanguageSaveResult = (LanguageSettings & { ok: true }) | { ok: false; error?: string };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { dronepath?: unknown }).dronepath;
});

function installBridge(overrides: {
  getLanguage?: () => Promise<LanguageSettings>;
  saveLanguage?: (preference: Locale | null) => Promise<LanguageSaveResult>;
} = {}) {
  const bridge = {
    getLanguage: vi.fn(
      overrides.getLanguage ??
        (async (): Promise<LanguageSettings> => ({ preference: null, locale: 'en' })),
    ),
    saveLanguage: vi.fn(
      overrides.saveLanguage ??
        (async (preference: Locale | null): Promise<LanguageSaveResult> => ({
          ok: true,
          preference,
          locale: preference ?? 'en',
        })),
    ),
  };
  (window as { dronepath?: unknown }).dronepath = bridge;
  return bridge;
}

describe('useLanguageSettings', () => {
  it('loads the initial language and applies saved selections', async () => {
    installBridge({
      getLanguage: async () => ({ preference: 'de', locale: 'de' }),
    });
    const { result } = renderHook(() => useLanguageSettings());

    await waitFor(() => expect(result.current.locale).toBe('de'));
    expect(result.current.preference).toBe('de');

    await act(async () => {
      await result.current.selectLanguage('en');
    });
    expect(result.current.locale).toBe('en');
    expect(result.current.preference).toBe('en');
    expect(result.current.error).toBe(false);
  });

  it('ignores a late initial getLanguage response after the user edits language', async () => {
    let resolveInitial: (value: LanguageSettings) => void = () => {};
    installBridge({
      getLanguage: () =>
        new Promise<LanguageSettings>((resolve) => {
          resolveInitial = resolve;
        }),
    });
    const { result } = renderHook(() => useLanguageSettings());

    await act(async () => {
      await result.current.selectLanguage('de');
    });
    expect(result.current.locale).toBe('de');

    await act(async () => {
      resolveInitial({ preference: null, locale: 'en' });
    });
    expect(result.current.locale).toBe('de');
    expect(result.current.preference).toBe('de');
  });

  it('blocks concurrent selectLanguage calls within the same tick using a ref', async () => {
    let resolveSave: (value: LanguageSaveResult) => void = () => {};
    const bridge = installBridge({
      saveLanguage: () =>
        new Promise<LanguageSaveResult>((resolve) => {
          resolveSave = resolve;
        }),
    });
    const { result } = renderHook(() => useLanguageSettings());

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = result.current.selectLanguage('de');
      second = result.current.selectLanguage('en');
    });
    expect(bridge.saveLanguage).toHaveBeenCalledTimes(1);
    expect(bridge.saveLanguage).toHaveBeenCalledWith('de');

    await act(async () => {
      resolveSave({ ok: true, preference: 'de', locale: 'de' });
      await Promise.all([first, second]);
    });
    expect(result.current.saving).toBe(false);
    expect(result.current.locale).toBe('de');

    await act(async () => {
      const p = result.current.selectLanguage(null);
      resolveSave({ ok: true, preference: null, locale: 'en' });
      await p;
    });
    expect(bridge.saveLanguage).toHaveBeenCalledTimes(2);
  });

  it('records an error and unlocks when saving refuses or throws', async () => {
    const bridge = installBridge({
      saveLanguage: async () => ({ ok: false }),
    });
    const { result } = renderHook(() => useLanguageSettings());

    await act(async () => {
      await result.current.selectLanguage('de');
    });
    expect(result.current.error).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(result.current.locale).toBe('en');

    bridge.saveLanguage.mockRejectedValueOnce(new Error('ipc failed'));
    await act(async () => {
      await result.current.selectLanguage('de');
    });
    expect(result.current.error).toBe(true);
    expect(result.current.saving).toBe(false);
  });
});
