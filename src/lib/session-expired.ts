import { msalInstance } from './msal-config';
import { savePostLoginRedirect } from './post-login-redirect';
import { routes } from './routes';

// Set right before the redirect, read once on the /login render so the page can
// explain why the user landed there. Distinct from the post-login redirect URL:
// this only says "a session died", not "go back here".
const NOTICE_KEY = 'sessionExpiredNotice';

// A dead-session redirect is already under way for THIS page load. Guards
// against a burst of concurrent 401s (or a re-entrant call) each firing their
// own redirect. Resets naturally on the full-page reload to /login.
let redirecting = false;

const AUTH_PATHS: readonly string[] = [routes.auth.login, routes.auth.signup];

/**
 * The session is dead — an expired refresh token (MSAL
 * `InteractionRequiredAuthError`) or a backend `401`. Remember where the user
 * was, flag the "you've been signed out" notice, drop the stale MSAL account so
 * the reloaded app starts cleanly logged-out (no redirect loop), then hard-
 * redirect to /login. Idempotent within a page load.
 */
export function handleSessionExpired(): void {
  if (redirecting) return;
  redirecting = true;

  const { pathname, search, hash } = window.location;
  // Never stash an auth route as the return target — that would bounce the user
  // back to /login (or /signup) right after they signed in.
  if (!AUTH_PATHS.includes(pathname)) {
    savePostLoginRedirect(pathname + search + hash);
  }

  try {
    sessionStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // Storage unavailable — the notice just won't show; the redirect still runs.
  }

  const go = () => window.location.assign(routes.auth.login);
  // clearCache is async; navigate only once the stale account is gone, so the
  // reloaded app doesn't see it, refetch, 401, and loop straight back here.
  Promise.resolve(msalInstance.clearCache()).catch(() => {}).finally(go);
}

/**
 * True exactly once — on the /login render immediately after a dead-session
 * redirect. Consuming clears the flag so a later manual visit to /login is quiet.
 */
export function consumeSessionExpiredNotice(): boolean {
  try {
    const flagged = sessionStorage.getItem(NOTICE_KEY) === '1';
    if (flagged) sessionStorage.removeItem(NOTICE_KEY);
    return flagged;
  } catch {
    return false;
  }
}
