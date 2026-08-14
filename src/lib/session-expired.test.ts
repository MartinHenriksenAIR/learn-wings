import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const clearCache = vi.fn().mockResolvedValue(undefined);
vi.mock('./msal-config', () => ({ msalInstance: { clearCache } }));

const realLocation = window.location;
function stubLocation(pathname: string, search = '', hash = '') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { pathname, search, hash, assign: vi.fn() },
  });
}

async function loadModule() {
  vi.resetModules();
  return import('./session-expired');
}

describe('session-expired', () => {
  beforeEach(() => {
    clearCache.mockClear();
    sessionStorage.clear();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  it('saves the current in-app path, flags the notice, and redirects to /login', async () => {
    stubLocation('/app/courses', '?tab=all');
    const { handleSessionExpired, consumeSessionExpiredNotice } = await loadModule();
    const { consumePostLoginRedirect } = await import('./post-login-redirect');

    handleSessionExpired();

    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/login'));
    expect(consumePostLoginRedirect()).toBe('/app/courses?tab=all');
    expect(consumeSessionExpiredNotice()).toBe(true);
  });

  it('clears the stale MSAL cache before redirecting so the reload cannot loop', async () => {
    stubLocation('/app/dashboard');
    const { handleSessionExpired } = await loadModule();

    handleSessionExpired();

    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalled());
    expect(clearCache).toHaveBeenCalledOnce();
  });

  it('fires a single redirect when several concurrent 401s call it', async () => {
    stubLocation('/app/dashboard');
    const { handleSessionExpired } = await loadModule();

    handleSessionExpired();
    handleSessionExpired();
    handleSessionExpired();

    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalled());
    expect(window.location.assign).toHaveBeenCalledOnce();
    expect(clearCache).toHaveBeenCalledOnce();
  });

  it('does not stash an auth route as the post-login redirect target', async () => {
    stubLocation('/login');
    const { handleSessionExpired } = await loadModule();
    const { consumePostLoginRedirect } = await import('./post-login-redirect');

    handleSessionExpired();

    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/login'));
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('does not stash any auth route (e.g. forgot-password) as the redirect target', async () => {
    stubLocation('/forgot-password');
    const { handleSessionExpired } = await loadModule();
    const { consumePostLoginRedirect } = await import('./post-login-redirect');

    handleSessionExpired();

    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/login'));
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('consumeSessionExpiredNotice returns false when no session expired', async () => {
    const { consumeSessionExpiredNotice } = await loadModule();
    expect(consumeSessionExpiredNotice()).toBe(false);
  });

  it('handleIdleTimeout redirects, clears the cache, and flags the idle notice only', async () => {
    stubLocation('/app/dashboard');
    const { handleIdleTimeout, consumeIdleTimeoutNotice, consumeSessionExpiredNotice } =
      await loadModule();

    handleIdleTimeout();

    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/login'));
    expect(clearCache).toHaveBeenCalledOnce();
    expect(consumeIdleTimeoutNotice()).toBe(true);
    expect(consumeSessionExpiredNotice()).toBe(false);
  });

  it('handleIdleTimeout stashes the current path so re-login returns the user', async () => {
    stubLocation('/app/courses', '?tab=all');
    const { handleIdleTimeout } = await loadModule();
    const { consumePostLoginRedirect } = await import('./post-login-redirect');

    handleIdleTimeout();

    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/login'));
    expect(consumePostLoginRedirect()).toBe('/app/courses?tab=all');
  });

  it('consumeIdleTimeoutNotice returns false when no idle timeout occurred', async () => {
    const { consumeIdleTimeoutNotice } = await loadModule();
    expect(consumeIdleTimeoutNotice()).toBe(false);
  });
});
