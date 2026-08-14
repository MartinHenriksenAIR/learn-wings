const KEY = 'postLoginRedirect';

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
  }
}
