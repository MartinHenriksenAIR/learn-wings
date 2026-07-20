import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('seat-requests', async ({ req, reply, requireOrgAdmin }) => {
  const { orgId } = await req.json() as { orgId?: unknown };
  if (!orgId || typeof orgId !== 'string') return reply(400, { error: 'orgId is required' });

  await requireOrgAdmin(orgId);

  const requests = await query(
    `SELECT sr.id, sr.org_id, sr.requested_by_user_id, sr.additional_seats,
            sr.unit_price_snapshot::float8 AS unit_price_snapshot, sr.currency, sr.status,
            sr.created_at, sr.fulfilled_at, sr.cancelled_at,
            p.full_name AS requester_name, p.email AS requester_email
       FROM seat_requests sr
       LEFT JOIN profiles p ON p.id = sr.requested_by_user_id
      WHERE sr.org_id = $1
      ORDER BY sr.created_at DESC`,
    [orgId],
  );
  return reply(200, { requests });
});
