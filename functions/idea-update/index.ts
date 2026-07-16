import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

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

export default endpoint('idea-update', async ({ req, profile, reply }) => {
  const body = await req.json() as { ideaId?: unknown; updates?: unknown };
  const { ideaId, updates } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return reply(400, { error: 'updates must be an object' });
  }

  const updatesObj = updates as Record<string, unknown>;

  // Filter to recognized whitelisted keys only (unknown keys are silently ignored).
  const updateKeys = Object.keys(updatesObj).filter((k) => ALLOWED_UPDATE_FIELDS.has(k));
  if (updateKeys.length === 0) {
    return reply(400, { error: 'No valid update fields provided' });
  }

  // Per-field validation on present whitelisted keys.
  for (const key of updateKeys) {
    const v = updatesObj[key];
    if (key === 'tags') {
      if (!Array.isArray(v) || !v.every((t) => typeof t === 'string')) {
        return reply(400, { error: 'tags must be an array of strings' });
      }
    } else if (key === 'business_area') {
      if (v !== null && !BUSINESS_AREAS.includes(v as string)) {
        return reply(400, {
          error: `business_area must be one of: ${BUSINESS_AREAS.join(', ')}`,
        });
      }
    } else {
      // STRING_FIELDS: string or null
      if (v !== null && typeof v !== 'string') {
        return reply(400, { error: `${key} must be a string` });
      }
    }
  }

  // Load idea
  const idea = await queryOne<IdeaRow>(
    `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
    [ideaId],
  );
  if (!idea) return reply(404, { error: 'Idea not found' });

  // Author-only: no admin bypass (org-admin writes go through idea-status-update).
  if (idea.user_id !== profile.id) {
    return reply(403, { error: 'Forbidden' });
  }

  // Draft-only.
  if (idea.status !== 'draft') {
    return reply(409, { error: 'Only draft ideas can be edited' });
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

  return reply(200, { idea: updatedIdea });
});
