import { describe, it, expect } from 'vitest';

describe('<html lang> on first load (#311)', () => {
  it("declares the resolved language, not index.html's static value", async () => {
    localStorage.setItem('preferred_language', 'en');
    document.documentElement.lang = 'da';

    const i18n = (await import('./index')).default;

    expect(i18n.resolvedLanguage).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
