import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

// idea_status enum values (provenance: supabase enum idea_status).
const VALID_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'in_review',
  'approved',
  'accepted',
  'rejected',
  'in_progress',
  'completed',
  'done',
  'archived',
];

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

    const body = await req.json() as {
      ideaId?: unknown;
      status?: unknown;
      adminNotes?: unknown;
      rejectionReason?: unknown;
    };
    const { ideaId, status, adminNotes, rejectionReason } = body;

    if (!ideaId || typeof ideaId !== 'string') {
      return corsResponse(origin, 400, { error: 'ideaId is required' }) as HttpResponseInit;
    }
    if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) {
      return corsResponse(origin, 400, {
        error: `status must be one of: ${VALID_STATUSES.join(', ')}`,
      }) as HttpResponseInit;
    }
    if (adminNotes !== undefined && adminNotes !== null && typeof adminNotes !== 'string') {
      return corsResponse(origin, 400, { error: 'adminNotes must be a string or null' }) as HttpResponseInit;
    }
    if (rejectionReason !== undefined && rejectionReason !== null && typeof rejectionReason !== 'string') {
      return corsResponse(origin, 400, { error: 'rejectionReason must be a string or null' }) as HttpResponseInit;
    }

    // Load idea
    const idea = await queryOne<IdeaRow>(
      `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
      [ideaId],
    );
    if (!idea) return corsResponse(origin, 404, { error: 'Idea not found' }) as HttpResponseInit;

    // Authorization: platform admin OR org admin of the IDEA's org (never client-supplied).
    // Authorship grants nothing here; status writes are admin-only.
    const canAccess = profile.is_platform_admin || await isOrgAdmin(profile.id, idea.org_id);
    if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    // Build whitelist-only dynamic UPDATE (supabase-js parity):
    //   status              — always set
    //   admin_notes         — only when adminNotes !== undefined (explicit null clears)
    //   rejection_reason    — ALWAYS set: 'rejected' ? (rejectionReason ?? null) : null
    // submitted_at (idea-submit only) and updated_at (DB trigger) are untouched.
    const params: unknown[] = [];
    const setClauses: string[] = [];

    params.push(status);
    setClauses.push(`status = $${params.length}`);

    if (adminNotes !== undefined) {
      params.push(adminNotes);
      setClauses.push(`admin_notes = $${params.length}`);
    }

    params.push(status === 'rejected' ? (rejectionReason ?? null) : null);
    setClauses.push(`rejection_reason = $${params.length}`);

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
app.http('idea-status-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
