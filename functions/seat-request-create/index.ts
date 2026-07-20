import { isUniqueViolation, queryOne, withTransaction } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { notifySeatRequest } from '../shared/seat-request-notify';

const MAX_SEATS = 1000;

interface SeatPricingValue {
  annual_price_per_seat: number | null;
  currency: string;
  notification_email: string;
}

export default endpoint('seat-request-create', async ({ req, context, profile, reply, requireOrgAdmin }) => {
  const { orgId, additionalSeats } = await req.json() as { orgId?: unknown; additionalSeats?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (typeof additionalSeats !== 'number' || !Number.isInteger(additionalSeats)
      || additionalSeats < 1 || additionalSeats > MAX_SEATS) {
    return reply(400, { error: `additionalSeats must be an integer between 1 and ${MAX_SEATS}` });
  }

  await requireOrgAdmin(orgId);

  // Binding price is authoritative server-side; the client never sends a price.
  const pricingRow = await queryOne<{ value: SeatPricingValue }>(
    `SELECT value FROM platform_settings WHERE key = 'seat_pricing'`,
  );
  const unitPrice = pricingRow?.value?.annual_price_per_seat ?? null;
  if (unitPrice === null) {
    return reply(409, { error: 'Seat pricing is not configured', code: 'SEAT_PRICING_UNCONFIGURED' });
  }
  const currency = pricingRow?.value?.currency ?? 'DKK';

  let outcome: { kind: 'created'; request: Record<string, unknown>; orgName: string; seatLimit: number; usedSeats: number }
    | { kind: 'not_found' } | { kind: 'unlimited' };
  try {
    outcome = await withTransaction(async (client) => {
      const orgRes = await client.query<{ name: string; seat_limit: number | null; active_count: number; pending_count: number }>(
        `SELECT o.name, o.seat_limit,
                (SELECT COUNT(*)::int FROM org_memberships m WHERE m.org_id = o.id AND m.status = 'active')  AS active_count,
                (SELECT COUNT(*)::int FROM invitations       i WHERE i.org_id = o.id AND i.status = 'pending') AS pending_count
           FROM organizations o
          WHERE o.id = $1
          FOR UPDATE OF o`,
        [orgId],
      );
      const org = orgRes.rows[0];
      if (!org) return { kind: 'not_found' as const };
      if (org.seat_limit === null) return { kind: 'unlimited' as const };

      const insertRes = await client.query(
        `INSERT INTO seat_requests (org_id, requested_by_user_id, additional_seats, unit_price_snapshot, currency)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, org_id, requested_by_user_id, additional_seats,
                   unit_price_snapshot::float8 AS unit_price_snapshot, currency, status, created_at`,
        [orgId, profile.id, additionalSeats, unitPrice, currency],
      );
      return {
        kind: 'created' as const,
        request: insertRes.rows[0],
        orgName: org.name,
        seatLimit: org.seat_limit,
        usedSeats: Number(org.active_count) + Number(org.pending_count),
      };
    });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: 'A seat request is already pending for this organization', code: 'REQUEST_ALREADY_PENDING' });
    }
    throw dbErr;
  }

  if (outcome.kind === 'not_found') return reply(404, { error: 'Organization not found' });
  if (outcome.kind === 'unlimited') return reply(409, { error: 'Organization has no seat limit', code: 'ORG_UNLIMITED' });

  // Notify the platform admin (best-effort — notifySeatRequest never throws).
  const requester = await queryOne<{ full_name: string; email: string | null }>(
    `SELECT full_name, email FROM profiles WHERE id = $1`, [profile.id],
  );
  await notifySeatRequest(context, {
    recipient: pricingRow?.value?.notification_email ?? 'jacob@ai-raadgivning.dk',
    orgName: outcome.orgName,
    requesterName: requester?.full_name ?? 'Unknown',
    requesterEmail: requester?.email ?? '',
    seatLimit: outcome.seatLimit,
    usedSeats: outcome.usedSeats,
    additionalSeats,
    unitPrice,
    currency,
    requestId: outcome.request.id as string,
    createdAt: outcome.request.created_at as string,
  });

  return reply(200, { request: outcome.request });
});
