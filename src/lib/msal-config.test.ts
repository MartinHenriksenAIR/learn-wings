import { describe, it, expect, vi, afterEach } from 'vitest';

describe('msal-config token cache location (#431)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('caches tokens in localStorage so an authenticated session is shared across tabs', async () => {
    vi.stubEnv('VITE_ENTRA_CLIENT_ID', '00000000-0000-0000-0000-000000000000');
    vi.resetModules();

    const { msalInstance } = await import('./msal-config');

    expect(msalInstance.getConfiguration().cache?.cacheLocation).toBe('localStorage');
  });
});
