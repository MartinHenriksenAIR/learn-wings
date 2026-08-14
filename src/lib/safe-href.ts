const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function safeHref(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) return undefined;

  return trimmed;
}
