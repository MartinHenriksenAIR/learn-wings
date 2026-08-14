import { msalInstance } from './msal-config';
import { savePostLoginRedirect } from './post-login-redirect';
import { routes } from './routes';

const NOTICE_KEY = 'sessionExpiredNotice';
const IDLE_NOTICE_KEY = 'idleTimeoutNotice';

let redirecting = false;

const AUTH_PATHS: readonly string[] = Object.values(routes.auth);

function redirectToLogin(noticeKey: string): void {
  if (redirecting) return;
  redirecting = true;

  const { pathname, search, hash } = window.location;
  if (!AUTH_PATHS.includes(pathname)) {
    savePostLoginRedirect(pathname + search + hash);
  }

  try {
    sessionStorage.setItem(noticeKey, '1');
  } catch {
  }

  const go = () => window.location.assign(routes.auth.login);
  Promise.resolve(msalInstance.clearCache()).catch(() => {}).finally(go);
}

export function handleSessionExpired(): void {
  redirectToLogin(NOTICE_KEY);
}

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

export function consumeSessionExpiredNotice(): boolean {
  return consumeNotice(NOTICE_KEY);
}

export function consumeIdleTimeoutNotice(): boolean {
  return consumeNotice(IDLE_NOTICE_KEY);
}
