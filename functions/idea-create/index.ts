import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

// Author-writable fields. Everything else (org_id, status, user_id, submitted_at,
// admin_notes, rejection_reason, category_id, course/lesson context) is NOT settable
// through this endpoint.
const STRING_FIELDS = [
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
] as const;

const BUSINESS_AREAS = ['hr', 'finance', 'sales', 'support', 'ops', 'it', 'legal', 'other'] as const;

export default endpoint('idea-create', async ({ req, profile, reply, requireActiveMember }) => {
    const body = await req.json() as Record<string, unknown>;
    const { orgId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }
    if (!body.title || typeof body.title !== 'string') {
      return reply(400, { error: 'title is required' });
    }

    // Validate string fields (string or null if present)
    for (const field of STRING_FIELDS) {
      const v = body[field];
      if (v !== undefined && v !== null && typeof v !== 'string') {
        return reply(400, { error: `${field} must be a string` });
      }
    }

    // Validate tags (array of strings if present)
    if (body.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string'))) {
      return reply(400, { error: 'tags must be an array of strings' });
    }

    // Validate business_area (one of the 8 enum values or null) — fail fast before PG enum cast 500.
    if (body.business_area !== undefined && body.business_area !== null
      && !(BUSINESS_AREAS as readonly string[]).includes(body.business_area as string)) {
      return reply(400, {
        error: `business_area must be one of: ${BUSINESS_AREAS.join(', ')}`,
      });
    }

    // Authorization: platform admin OR active member of the org
    await requireActiveMember(orgId);

    // Insert. user_id is ALWAYS profile.id (never client-supplied); status is ALWAYS 'draft'.
    const idea = await queryOne(
      `INSERT INTO ideas
        (org_id, user_id, status, title, description, problem_statement, proposed_solution,
         expected_impact, business_area, tags, current_process, pain_points, affected_roles,
         frequency_volume, proposed_improvement, desired_process, data_inputs, systems_involved,
         constraints_risks, success_metrics)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [
        orgId,
        profile.id,
        'draft', // status is ALWAYS draft — never client-supplied
        body.title,
        (body.description as string | null | undefined) ?? null,
        (body.problem_statement as string | null | undefined) ?? null,
        (body.proposed_solution as string | null | undefined) ?? null,
        (body.expected_impact as string | null | undefined) ?? null,
        (body.business_area as string | null | undefined) ?? null,
        (body.tags as string[] | undefined) ?? [],
        (body.current_process as string | null | undefined) ?? null,
        (body.pain_points as string | null | undefined) ?? null,
        (body.affected_roles as string | null | undefined) ?? null,
        (body.frequency_volume as string | null | undefined) ?? null,
        (body.proposed_improvement as string | null | undefined) ?? null,
        (body.desired_process as string | null | undefined) ?? null,
        (body.data_inputs as string | null | undefined) ?? null,
        (body.systems_involved as string | null | undefined) ?? null,
        (body.constraints_risks as string | null | undefined) ?? null,
        (body.success_metrics as string | null | undefined) ?? null,
      ],
    );

    return reply(200, { idea });
});
