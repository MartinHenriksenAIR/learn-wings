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
