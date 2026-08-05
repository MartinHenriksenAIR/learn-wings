/**
 * Convert a display name into a URL-safe slug: lowercase, ASCII, hyphen-joined.
 *
 * Accented Latin letters fold to their base form via NFD decomposition
 * (é→e, å→a); the two Danish letters that have no canonical decomposition are
 * mapped explicitly (ø→o, æ→ae). Any run of remaining non-alphanumerics
 * collapses to a single hyphen, and leading/trailing hyphens are trimmed.
 *
 * Returns '' when nothing slug-able remains (e.g. slugify('!!!')). Callers that
 * need a guaranteed non-empty slug must supply their own fallback — this helper
 * stays pure and does not invent one.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')                    // é → e + U+0301, å → a + U+030A, …
    .replace(/[\u0300-\u036f]/g, '')     // strip the combining marks left behind
    .toLowerCase()
    .replace(/ø/g, 'o')                  // ø/æ have no NFD decomposition — map by hand
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')         // any non-alnum run → one hyphen
    .replace(/^-+|-+$/g, '');            // trim leading/trailing hyphens
}
