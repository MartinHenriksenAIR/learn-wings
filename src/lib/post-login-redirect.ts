// Preserves the URL a user was headed to when a route guard bounced them to
// /login. Router state cannot be used: the Entra login is a full-page redirect
// and React Router state does not survive it — sessionStorage does (and matches
// the tab-scoped MSAL cache in msal-config.ts).
const KEY = 'postLoginRedirect';

// Only in-app absolute paths — never anything that could leave the SPA.
// Must start with a single '/' (not '//', a protocol-relative open redirect)
// and contain no backslash or control char anywhere: browsers and react-router
// normalize '\' to '/', so '/\evil.com' would escape to an external origin
// (CVE-2025-68470 / GHSA-wrjc-x8rr-h8h6 class, unpatched in react-router 6.x).
// This guard is defense-in-depth, independent of the router version.
const isInAppPath = (url: string): boolean => {
  if (!/^\/(?!\/)/.test(url)) return false; // single leading slash only
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c <= 0x1f || url[i] === '\\') return false; // control chars or backslash
  }
  return true;
};

export function savePostLoginRedirect(url: string) {
  if (!isInAppPath(url)) return;
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    // Storage unavailable (private mode quirks) — fall back to role home.
  }
}

export function consumePostLoginRedirect(): string | null {
  try {
    const url = sessionStorage.getItem(KEY);
    if (url) sessionStorage.removeItem(KEY);
    return url && isInAppPath(url) ? url : null;
  } catch {
    return null;
  }
}

export function clearPostLoginRedirect() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
