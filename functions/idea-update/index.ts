import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { buildUpdateSet } from '../shared/update-builder';
import { loadIdea, checkAuthorDraft } from '../shared/ideas';

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

export default endpoint('idea-update', async ({ req, profile, reply }) => {
  const body = await req.json() as { ideaId?: unknown; updates?: unknown };
  const { ideaId, updates } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }

  // Shape check + whitelist walk + SET-clause build (shared #252). NOTE: unknown
  // keys now 400 ("Invalid update field: X") — this endpoint used to silently
  // drop them; the frontend only ever sends whitelisted keys (verified #252).
  const built = buildUpdateSet(updates, ALLOWED_UPDATE_FIELDS, {
    emptyError: 'No valid update fields provided',
  });
  if (!built.ok) {
    return reply(400, { error: built.error });
  }

  const updatesObj = updates as Record<string, unknown>;
  const updateKeys = Object.keys(updatesObj);

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
      if (v !== null && typeof v !== 'string') {
        return reply(400, { error: `${key} must be a string` });
      }
    }
  }

  const idea = await loadIdea(ideaId);
  if (!idea) return reply(404, { error: 'Idea not found' });

  // Author-only-403 + draft-only-409 (shared/ideas; no admin bypass — org-admin
  // writes go through idea-status-update).
  const gate = checkAuthorDraft(idea, profile, { notDraftError: 'Only draft ideas can be edited' });
  if (!gate.ok) return reply(gate.status, gate.body);

  const { setClauses, params } = built;
  params.push(ideaId);
  const idIndex = params.length;

  const updatedIdea = await queryOne(
    `UPDATE ideas SET ${setClauses.join(', ')} WHERE id = $${idIndex} RETURNING *`,
    params,
  );

  return reply(200, { idea: updatedIdea });
});
