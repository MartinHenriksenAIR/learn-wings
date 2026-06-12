import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

interface ReportRow {
  org_id: string | null;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as {
      reportId?: unknown;
      status?: unknown;
      adminNotes?: unknown;
    };
    const { reportId, status, adminNotes } = body;

    if (!reportId || typeof reportId !== 'string') {
      return corsResponse(origin, 400, { error: 'reportId is required' });
    }
    if (status !== undefined && status !== 'reviewed' && status !== 'dismissed') {
      return corsResponse(origin, 400, { error: "status must be 'reviewed' or 'dismissed'" });
    }
    if (adminNotes !== undefined && adminNotes !== null && typeof adminNotes !== 'string') {
      return corsResponse(origin, 400, { error: 'adminNotes must be a string or null' });
    }
    if (status === undefined && adminNotes === undefined) {
      return corsResponse(origin, 400, { error: 'Provide status or adminNotes to update' });
    }

    // Load report
    const report = await queryOne<ReportRow>(
      `SELECT org_id FROM community_reports WHERE id = $1`,
      [reportId],
    );
    if (!report) return corsResponse(origin, 404, { error: 'Report not found' });

    // Authorization: platform admin OR org admin of the report's org (global reports = plat admin only)
    const canAccess = profile.is_platform_admin ||
      (report.org_id !== null && await isOrgAdmin(profile.id, report.org_id));
    if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Build dynamic UPDATE
    const params: unknown[] = [];
    const setClauses: string[] = [];

    if (status !== undefined) {
      params.push(status);
      setClauses.push(`status = $${params.length}`);
    }
    if (adminNotes !== undefined) {
      params.push(adminNotes);
      setClauses.push(`admin_notes = $${params.length}`);
    }

    // Always set reviewed_by and reviewed_at (server-set)
    params.push(profile.id);
    setClauses.push(`reviewed_by = $${params.length}`);
    setClauses.push(`reviewed_at = now()`);

    params.push(reportId);
    const idIndex = params.length;

    const updatedReport = await queryOne(
      `UPDATE community_reports SET ${setClauses.join(', ')} WHERE id = $${idIndex} RETURNING *`,
      params,
    );

    return corsResponse(origin, 200, { report: updatedReport });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('community-report-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
