import { describe, it, expect } from 'vitest';

// The first-load half of #189, which #311 found unguarded. This lives in its own
// file, with no static import of './index', on purpose: vitest isolates the
// module registry per test *file*, so importing the module inside the test body
// is the only way to observe i18next initializing exactly once — the very path
// that was broken. In src/i18n/index.test.ts the top-level import initializes
// i18next before any test body runs, and vi.resetModules() cannot undo that
// (i18next is externalized, so the singleton and its listeners survive), which
// makes the bug unobservable there.
//
// Only the English case can catch this: 'da' is both index.html's hardcoded
// value and the resolved language for Danish users, so a Danish assertion passes
// whether or not the sync ever runs. That coincidence is why the bug shipped.
describe('<html lang> on first load (#311)', () => {
  it("declares the resolved language, not index.html's static value", async () => {
    localStorage.setItem('preferred_language', 'en');
    document.documentElement.lang = 'da';

    const i18n = (await import('./index')).default;

    expect(i18n.resolvedLanguage).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
