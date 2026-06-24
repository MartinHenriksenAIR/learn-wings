import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne, isUniqueViolation } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile } from '../shared/profile';

interface ReportRow {
  id: string;
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as {
      targetType?: unknown;
      targetId?: unknown;
      orgId?: unknown;
      reason?: unknown;
    };
    const { targetType, targetId, orgId, reason } = body;

    if (targetType !== 'post' && targetType !== 'comment') {
      return corsResponse(origin, 400, { error: "targetType must be 'post' or 'comment'" });
    }
    if (!targetId || typeof targetId !== 'string') {
      return corsResponse(origin, 400, { error: 'targetId is required' });
    }
    if (!reason || typeof reason !== 'string') {
      return corsResponse(origin, 400, { error: 'reason is required' });
    }
    if (orgId !== undefined && orgId !== null && typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId must be a string or null' });
    }

    // Dedupe check (RLS parity)
    const existing = await queryOne<ReportRow>(
      `SELECT id FROM community_reports WHERE reporter_user_id = $1 AND target_id = $2 AND target_type = $3`,
      [profile.id, targetId, targetType],
    );
    if (existing) {
      return corsResponse(origin, 409, { error: 'You have already reported this content.' });
    }

    let report: unknown;
    try {
      report = await queryOne(
        `INSERT INTO community_reports (reporter_user_id, target_type, target_id, org_id, reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [profile.id, targetType, targetId, orgId ?? null, reason],
      );
    } catch (insertErr: unknown) {
      if (isUniqueViolation(insertErr)) {
        return corsResponse(origin, 409, { error: 'You have already reported this content.' });
      }
      throw insertErr;
    }

    return corsResponse(origin, 200, { report });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('community-report-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
