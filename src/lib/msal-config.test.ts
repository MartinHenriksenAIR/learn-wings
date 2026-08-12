// #431: MSAL must cache tokens in localStorage, not sessionStorage. sessionStorage
// is scoped per tab, so a new browser tab starts with an empty cache and falls back
// to the login page. localStorage is shared across all tabs of the origin, giving
// silent cross-tab SSO. This guards the setting — nothing else does (the module is
// mocked in every other test), so a silent flip back to sessionStorage would slip by.
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('msal-config token cache location (#431)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('caches tokens in localStorage so an authenticated session is shared across tabs', async () => {
    // A non-empty clientId is required at import (PublicClientApplication is
    // instantiated at module top level); the value itself is irrelevant here.
    vi.stubEnv('VITE_ENTRA_CLIENT_ID', '00000000-0000-0000-0000-000000000000');
    vi.resetModules();

    const { msalInstance } = await import('./msal-config');

    expect(msalInstance.getConfiguration().cache?.cacheLocation).toBe('localStorage');
  });
});
