import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface ReportRow {
  id: string;
}

export default endpoint('community-report-create', async ({ req, profile, reply }) => {
  const body = await req.json() as {
    targetType?: unknown;
    targetId?: unknown;
    orgId?: unknown;
    reason?: unknown;
  };
  const { targetType, targetId, orgId, reason } = body;

  if (targetType !== 'post' && targetType !== 'comment') {
    return reply(400, { error: "targetType must be 'post' or 'comment'" });
  }
  if (!targetId || typeof targetId !== 'string') {
    return reply(400, { error: 'targetId is required' });
  }
  if (!reason || typeof reason !== 'string') {
    return reply(400, { error: 'reason is required' });
  }
  if (orgId !== undefined && orgId !== null && typeof orgId !== 'string') {
    return reply(400, { error: 'orgId must be a string or null' });
  }

  // Dedupe check (RLS parity)
  const existing = await queryOne<ReportRow>(
    `SELECT id FROM community_reports WHERE reporter_user_id = $1 AND target_id = $2 AND target_type = $3`,
    [profile.id, targetId, targetType],
  );
  if (existing) {
    return reply(409, { error: 'You have already reported this content.' });
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
      return reply(409, { error: 'You have already reported this content.' });
    }
    throw insertErr;
  }

  return reply(200, { report });
});
