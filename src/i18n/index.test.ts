import { describe, it, expect } from 'vitest';

import i18n from './index';

describe('i18n default language (#119)', () => {
  it('defaults to Danish when the browser language is not supported', () => {
    // The first fallbackLng entry is the language i18next renders when the
    // detected browser language is neither en nor da.
    const fallback = i18n.options.fallbackLng as string[];
    expect(fallback[0]).toBe('da');
  });

  it('keeps English in the fallback chain', () => {
    const fallback = i18n.options.fallbackLng as string[];
    expect(fallback).toContain('en');
  });

  it('browser-matches both supported languages', () => {
    expect(i18n.options.supportedLngs).toContain('da');
    expect(i18n.options.supportedLngs).toContain('en');
    expect(i18n.options.detection?.order).toContain('navigator');
  });

  it('syncs <html lang> to the active language on change (#189)', async () => {
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    await i18n.changeLanguage('da');
    expect(document.documentElement.lang).toBe('da');
  });
});
