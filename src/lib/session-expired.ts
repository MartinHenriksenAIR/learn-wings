import { msalInstance } from './msal-config';
import { savePostLoginRedirect } from './post-login-redirect';
import { routes } from './routes';

// Set right before the redirect, read once on the /login render so the page can
// explain why the user landed there. Distinct from the post-login redirect URL:
// these only say *why* the session ended, not "go back here". Two reasons, two
// keys, so /login can show the right message: a dead session vs an idle timeout.
const NOTICE_KEY = 'sessionExpiredNotice';
const IDLE_NOTICE_KEY = 'idleTimeoutNotice';

// A login redirect is already under way for THIS page load. Guards against a
// burst of concurrent 401s (or a re-entrant call) each firing their own
// redirect. Resets naturally on the full-page reload to /login.
let redirecting = false;

// Every auth route (login, signup, forgot/reset password) — derived so a new
// auth route can't silently become a valid post-login return target.
const AUTH_PATHS: readonly string[] = Object.values(routes.auth);

/**
 * Shared teardown for every "the session ended, go to /login" path: remember
 * where the user was, flag the given notice, drop the stale MSAL account so the
 * reloaded app starts cleanly logged-out (no redirect loop), then hard-redirect
 * to /login. Idempotent within a page load.
 */
function redirectToLogin(noticeKey: string): void {
  if (redirecting) return;
  redirecting = true;

  const { pathname, search, hash } = window.location;
  // Never stash an auth route as the return target — that would bounce the user
  // back to /login (or /signup) right after they signed in.
  if (!AUTH_PATHS.includes(pathname)) {
    savePostLoginRedirect(pathname + search + hash);
  }

  try {
    sessionStorage.setItem(noticeKey, '1');
  } catch {
    // Storage unavailable — the notice just won't show; the redirect still runs.
  }

  const go = () => window.location.assign(routes.auth.login);
  // clearCache is async; navigate only once the stale account is gone, so the
  // reloaded app doesn't see it, refetch, 401, and loop straight back here.
  // clearCache() removes only MSAL's own localStorage keys (msal-prefixed /
  // clientId-keyed), so the redirect target + notice in sessionStorage set just
  // above survive it.
  Promise.resolve(msalInstance.clearCache()).catch(() => {}).finally(go);
}

/**
 * The session is dead — an expired refresh token (MSAL
 * `InteractionRequiredAuthError`) or a backend `401`.
 */
export function handleSessionExpired(): void {
  redirectToLogin(NOTICE_KEY);
}

/**
 * The user was idle past the timeout window (#447). Clears the local session
 * and redirects to /login exactly like a dead session, but flags a distinct
 * "signed out for inactivity" notice. Note this only clears the *local* MSAL
 * cache (no Entra logout), so a valid Entra SSO cookie can re-authenticate the
 * next sign-in silently — a deliberate trade-off for a snappier flow.
 */
export function handleIdleTimeout(): void {
  redirectToLogin(IDLE_NOTICE_KEY);
}

function consumeNotice(key: string): boolean {
  try {
    const flagged = sessionStorage.getItem(key) === '1';
    if (flagged) sessionStorage.removeItem(key);
    return flagged;
  } catch {
    return false;
  }
}

/**
 * True exactly once — on the /login render immediately after a dead-session
 * redirect. Consuming clears the flag so a later manual visit to /login is quiet.
 */
export function consumeSessionExpiredNotice(): boolean {
  return consumeNotice(NOTICE_KEY);
}

/**
 * True exactly once — on the /login render immediately after an idle-timeout
 * redirect. Consuming clears the flag so a later manual visit to /login is quiet.
 */
export function consumeIdleTimeoutNotice(): boolean {
  return consumeNotice(IDLE_NOTICE_KEY);
}
