import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { requirePlatformAdmin } from '../shared/guards';

const ALLOWED_KEYS = ['branding', 'user_access', 'email', 'features'] as const;
type SettingKey = typeof ALLOWED_KEYS[number];

interface PlatformSettingsUpdateBody {
  key?: unknown;
  value?: unknown;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const gate = await requirePlatformAdmin(req, origin);
    if (!gate.ok) return gate.response;
    const { profile } = gate;

    const body = await req.json() as PlatformSettingsUpdateBody;

    if (typeof body.key !== 'string' || !(ALLOWED_KEYS as readonly string[]).includes(body.key)) {
      return corsResponse(origin, 400, { error: 'key must be one of: branding, user_access, email, features' });
    }
    const key = body.key as SettingKey;

    if (
      body.value === null ||
      typeof body.value !== 'object' ||
      Array.isArray(body.value)
    ) {
      return corsResponse(origin, 400, { error: 'value must be a plain object' });
    }
    const value = body.value as Record<string, unknown>;

    // updated_at is managed by a DB trigger on UPDATE; updated_by is the authenticated caller's profile id.
    // JSON.stringify is deliberate, not required: pg would auto-stringify a plain object, but explicit
    // serialization sidesteps pg's array-vs-jsonb param footgun if the value guard ever loosens.
    const setting = await queryOne(
      `UPDATE platform_settings SET value = $2, updated_by = $3 WHERE key = $1 RETURNING key, value`,
      [key, JSON.stringify(value), profile.id],
    );

    if (!setting) return corsResponse(origin, 404, { error: 'Setting not found' });

    return corsResponse(origin, 200, { setting });
  } catch (err: unknown) {
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('platform-settings-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
