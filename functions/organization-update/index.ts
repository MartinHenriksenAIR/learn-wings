import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

// Mirrors the zod/schema constraints in organization-create — same DB,
// same validation messages so the page-side error handling is identical.
const SLUG_REGEX = /^[a-z0-9-]+$/;
const ALLOWED_UPDATE_FIELDS = new Set(['name', 'slug', 'logo_url', 'seat_limit']);

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { orgId?: unknown; updates?: unknown };
    const { orgId, updates } = body;

    // Validation first (matches resource-update order), authz second.
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return corsResponse(origin, 400, { error: 'updates must be an object' }) as HttpResponseInit;
    }

    const updatesObj = updates as Record<string, unknown>;
    const updateKeys = Object.keys(updatesObj);
    for (const key of updateKeys) {
      if (!ALLOWED_UPDATE_FIELDS.has(key)) {
        return corsResponse(origin, 400, { error: `Invalid update field: ${key}` }) as HttpResponseInit;
      }
    }
    if (updateKeys.length === 0) {
      return corsResponse(origin, 400, { error: 'No update fields provided' }) as HttpResponseInit;
    }

    // Per-field validation — messages aligned with organization-create.
    for (const key of updateKeys) {
      const v = updatesObj[key];
      if (key === 'name') {
        if (typeof v !== 'string' || v.length < 2 || v.length > 100) {
          return corsResponse(origin, 400, { error: 'name must be a string between 2 and 100 characters' }) as HttpResponseInit;
        }
      } else if (key === 'slug') {
        if (typeof v !== 'string' || v.length < 2 || v.length > 50) {
          return corsResponse(origin, 400, { error: 'slug must be a string between 2 and 50 characters' }) as HttpResponseInit;
        }
        if (!SLUG_REGEX.test(v)) {
          return corsResponse(origin, 400, { error: 'slug must contain only lowercase letters, numbers, and hyphens' }) as HttpResponseInit;
        }
      } else if (key === 'logo_url') {
        if (v !== null && typeof v !== 'string') {
          return corsResponse(origin, 400, { error: 'logo_url must be a string or null' }) as HttpResponseInit;
        }
      } else if (key === 'seat_limit') {
        if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1)) {
          return corsResponse(origin, 400, { error: 'seat_limit must be a positive integer or null' }) as HttpResponseInit;
        }
      }
    }

    // Authorization: platform admin → any whitelisted field; org admin of the target
    // org → logo_url ONLY.
    // RLS provenance: supabase/migrations/20260127153401_*.sql:269-276 ("Platform admins
    // can do everything with orgs") + 20260128223657 ("Org admins can update their org
    // logo", FOR UPDATE is_org_admin(id)). The old policy was row-scoped (technically any
    // column); we tighten to the migration's stated intent — logo_url only (deliberate).
    if (!profile.is_platform_admin) {
      const onlyLogoUrl = updateKeys.every((key) => key === 'logo_url');
      const allowed = onlyLogoUrl && await isOrgAdmin(profile.id, orgId);
      if (!allowed) {
        return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
      }
    }

    // Dynamic UPDATE over the whitelisted keys (pattern: resource-update:104-125).
    // UPDATE ... RETURNING returns no row when WHERE matches nothing, giving us
    // the 404 distinction without a separate existence SELECT.
    const params: unknown[] = [];
    const setClauses = updateKeys.map((key) => {
      params.push(updatesObj[key]);
      return `${key} = $${params.length}`;
    });
    params.push(orgId);
    const idIndex = params.length;

    try {
      const organization = await queryOne(
        `UPDATE organizations SET ${setClauses.join(', ')}
         WHERE id = $${idIndex}
         RETURNING id, name, slug, logo_url, seat_limit, created_at`,
        params,
      );

      if (!organization) return corsResponse(origin, 404, { error: 'Organization not found' }) as HttpResponseInit;
      return corsResponse(origin, 200, { organization }) as HttpResponseInit;
    } catch (dbErr: unknown) {
      // Postgres unique_violation on the slug UNIQUE constraint.
      if ((dbErr as { code?: string })?.code === '23505') {
        return corsResponse(origin, 409, { error: 'Slug already in use' }) as HttpResponseInit;
      }
      throw dbErr;
    }
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('organization-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
