import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

interface ReportRow {
  org_id: string | null;
}

export default endpoint('community-report-update', async ({ req, profile, reply }) => {
  const body = await req.json() as {
    reportId?: unknown;
    status?: unknown;
    adminNotes?: unknown;
  };
  const { reportId, status, adminNotes } = body;

  if (!reportId || typeof reportId !== 'string') {
    return reply(400, { error: 'reportId is required' });
  }
  if (status !== undefined && status !== 'reviewed' && status !== 'dismissed') {
    return reply(400, { error: "status must be 'reviewed' or 'dismissed'" });
  }
  if (adminNotes !== undefined && adminNotes !== null && typeof adminNotes !== 'string') {
    return reply(400, { error: 'adminNotes must be a string or null' });
  }
  if (status === undefined && adminNotes === undefined) {
    return reply(400, { error: 'Provide status or adminNotes to update' });
  }

  // Load report
  const report = await queryOne<ReportRow>(
    `SELECT org_id FROM community_reports WHERE id = $1`,
    [reportId],
  );
  if (!report) return reply(404, { error: 'Report not found' });

  // Authorization: platform admin OR org admin of the report's org (global reports = plat admin only)
  const canAccess = profile.is_platform_admin ||
    (report.org_id !== null && await isOrgAdmin(profile.id, report.org_id));
  if (!canAccess) return reply(403, { error: 'Forbidden' });

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

  return reply(200, { report: updatedReport });
});
