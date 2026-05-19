const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://ai-uddannelse.dk').split(',').filter(Boolean);

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed ?? '',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export function corsResponse(origin: string | null, status: number, body: unknown): object {
  return {
    status,
    headers: getCorsHeaders(origin),
    body: JSON.stringify(body),
  };
}

export function corsPreflightResponse(origin: string | null): object {
  return { status: 204, headers: getCorsHeaders(origin), body: '' };
}
