// Hand-rolled (not shared/endpoint.ts): legacy oid-only single-SQL authz check (entra_oid without tid) — pending identity normalization.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const { orgId } = await req.json() as { orgId: string };

    // Auth check: platform admin OR org admin for this org
    // Join through profiles so we match on entra_oid, not profiles.id
    const authCheck = await queryOne<{ can_access: boolean }>(
      `SELECT (
        EXISTS(SELECT 1 FROM profiles WHERE entra_oid = $1 AND is_platform_admin = TRUE)
        OR EXISTS(
          SELECT 1 FROM org_memberships om
          JOIN profiles p ON p.id = om.user_id
          WHERE p.entra_oid = $1 AND om.org_id = $2 AND om.role = 'org_admin' AND om.status = 'active'
        )
      ) AS can_access`,
      [user.id, orgId]
    );
    if (!authCheck?.can_access) return corsResponse(origin, 403, { error: 'Forbidden' });

    const [members, enrollments, quizAttempts, org] = await Promise.all([
      query(
        'SELECT om.*, p.full_name, p.email FROM org_memberships om JOIN profiles p ON p.id = om.user_id WHERE om.org_id = $1 AND om.status = $2',
        [orgId, 'active']
      ),
      query('SELECT * FROM enrollments WHERE org_id = $1', [orgId]),
      query(
        'SELECT * FROM quiz_attempts qa JOIN enrollments e ON e.user_id = qa.user_id AND e.org_id = $1 WHERE e.org_id = $1',
        [orgId]
      ),
      queryOne('SELECT * FROM organizations WHERE id = $1', [orgId]),
    ]);

    return corsResponse(origin, 200, { members, enrollments, quizAttempts, org });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('org-analytics-data', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
