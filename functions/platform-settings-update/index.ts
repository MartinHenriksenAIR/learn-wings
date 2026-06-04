import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

const ALLOWED_KEYS = ['branding', 'user_access', 'email', 'features'] as const;
type SettingKey = typeof ALLOWED_KEYS[number];

interface PlatformSettingsUpdateBody {
  key?: unknown;
  value?: unknown;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

    const body = await req.json() as PlatformSettingsUpdateBody;

    if (typeof body.key !== 'string' || !(ALLOWED_KEYS as readonly string[]).includes(body.key)) {
      return corsResponse(origin, 400, { error: 'key must be one of: branding, user_access, email, features' }) as HttpResponseInit;
    }
    const key = body.key as SettingKey;

    if (
      body.value === null ||
      typeof body.value !== 'object' ||
      Array.isArray(body.value)
    ) {
      return corsResponse(origin, 400, { error: 'value must be a plain object' }) as HttpResponseInit;
    }
    const value = body.value as Record<string, unknown>;

    // updated_at is managed by a DB trigger on UPDATE; updated_by is the authenticated caller's profile id.
    // JSON.stringify is used for the jsonb param because pg accepts a JSON string for jsonb columns.
    const setting = await queryOne(
      `UPDATE platform_settings SET value = $2, updated_by = $3 WHERE key = $1 RETURNING key, value`,
      [key, JSON.stringify(value), profile.id],
    );

    if (!setting) return corsResponse(origin, 404, { error: 'Setting not found' }) as HttpResponseInit;

    return corsResponse(origin, 200, { setting }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('platform-settings-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
