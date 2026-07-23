import { describe, it, expect } from 'vitest';

import i18n from './index';

describe('i18n default language (#226 — overrides #119)', () => {
  it('uses English as the catch-all fallback for unsupported browser languages', () => {
    // #226 flips #119's Danish catch-all: a browser that is neither da nor en
    // now resolves to English, not Danish. i18next normalizes fallbackLng: 'en'
    // to ['en'] — the chain must be exactly English, with no Danish entry.
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });

  it('resolves a third browser language (e.g. Spanish) to English, never Danish', () => {
    const utils = i18n.services.languageUtils;
    // getFallbackCodes computes what an unsupported code falls back to.
    expect(utils.getFallbackCodes(i18n.options.fallbackLng, 'es')).toEqual(['en']);
    expect(utils.getFallbackCodes(i18n.options.fallbackLng, 'fr-FR')).toEqual(['en']);
    expect(utils.getFallbackCodes(i18n.options.fallbackLng, 'de')).not.toContain('da');
  });

  it('still browser-matches both supported languages (da browser → da, en browser → en)', () => {
    expect(i18n.options.supportedLngs).toContain('da');
    expect(i18n.options.supportedLngs).toContain('en');
    expect(i18n.options.detection?.order).toContain('navigator');
  });

  it('keeps English as the secondary key fallback for any key missing in Danish', () => {
    // A Danish user with a key absent from da.json still gets the English string:
    // 'en' is the fallback for every code, including 'da'.
    const utils = i18n.services.languageUtils;
    expect(utils.getFallbackCodes(i18n.options.fallbackLng, 'da')).toEqual(['en']);
  });

  it('syncs <html lang> to the active language on change (#189)', async () => {
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    await i18n.changeLanguage('da');
    expect(document.documentElement.lang).toBe('da');
  });
});
