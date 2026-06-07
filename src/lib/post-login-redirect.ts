// Preserves the URL a user was headed to when a route guard bounced them to
// /login. Router state cannot be used: the Entra login is a full-page redirect
// and React Router state does not survive it — sessionStorage does (and matches
// the tab-scoped MSAL cache in msal-config.ts).
const KEY = 'postLoginRedirect';

export function savePostLoginRedirect(url: string) {
  // Only in-app absolute paths — never anything that could leave the SPA.
  if (!url.startsWith('/') || url.startsWith('//')) return;
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
    return url && url.startsWith('/') && !url.startsWith('//') ? url : null;
  } catch {
    return null;
  }
}
