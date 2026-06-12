import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

// Author-writable fields. status, user_id, org_id, submitted_at, admin_notes,
// rejection_reason, category_id, course/lesson context are NOT editable here —
// admin/status writes go through idea-status-update.
const STRING_FIELDS = new Set([
  'title',
  'description',
  'problem_statement',
  'proposed_solution',
  'expected_impact',
  'current_process',
  'pain_points',
  'affected_roles',
  'frequency_volume',
  'proposed_improvement',
  'desired_process',
  'data_inputs',
  'systems_involved',
  'constraints_risks',
  'success_metrics',
]);

const ALLOWED_UPDATE_FIELDS = new Set([...STRING_FIELDS, 'tags', 'business_area']);

const BUSINESS_AREAS = ['hr', 'finance', 'sales', 'support', 'ops', 'it', 'legal', 'other'];

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { ideaId?: unknown; updates?: unknown };
    const { ideaId, updates } = body;

    if (!ideaId || typeof ideaId !== 'string') {
      return corsResponse(origin, 400, { error: 'ideaId is required' }) as HttpResponseInit;
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return corsResponse(origin, 400, { error: 'updates must be an object' }) as HttpResponseInit;
    }

    const updatesObj = updates as Record<string, unknown>;

    // Filter to recognized whitelisted keys only (unknown keys are silently ignored).
    const updateKeys = Object.keys(updatesObj).filter((k) => ALLOWED_UPDATE_FIELDS.has(k));
    if (updateKeys.length === 0) {
      return corsResponse(origin, 400, { error: 'No valid update fields provided' }) as HttpResponseInit;
    }

    // Per-field validation on present whitelisted keys.
    for (const key of updateKeys) {
      const v = updatesObj[key];
      if (key === 'tags') {
        if (!Array.isArray(v) || !v.every((t) => typeof t === 'string')) {
          return corsResponse(origin, 400, { error: 'tags must be an array of strings' }) as HttpResponseInit;
        }
      } else if (key === 'business_area') {
        if (v !== null && !BUSINESS_AREAS.includes(v as string)) {
          return corsResponse(origin, 400, {
            error: `business_area must be one of: ${BUSINESS_AREAS.join(', ')}`,
          }) as HttpResponseInit;
        }
      } else {
        // STRING_FIELDS: string or null
        if (v !== null && typeof v !== 'string') {
          return corsResponse(origin, 400, { error: `${key} must be a string` }) as HttpResponseInit;
        }
      }
    }

    // Load idea
    const idea = await queryOne<IdeaRow>(
      `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
      [ideaId],
    );
    if (!idea) return corsResponse(origin, 404, { error: 'Idea not found' }) as HttpResponseInit;

    // Author-only: no admin bypass (org-admin writes go through idea-status-update).
    if (idea.user_id !== profile.id) {
      return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

    // Draft-only.
    if (idea.status !== 'draft') {
      return corsResponse(origin, 409, { error: 'Only draft ideas can be edited' }) as HttpResponseInit;
    }

    // Build dynamic UPDATE over the provided whitelisted keys only.
    const params: unknown[] = [];
    const setClauses = updateKeys.map((key) => {
      params.push(updatesObj[key]);
      return `${key} = $${params.length}`;
    });
    params.push(ideaId);
    const idIndex = params.length;

    const updatedIdea = await queryOne(
      `UPDATE ideas SET ${setClauses.join(', ')} WHERE id = $${idIndex} RETURNING *`,
      params,
    );

    return corsResponse(origin, 200, { idea: updatedIdea }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('idea-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
