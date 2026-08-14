import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { loadIdea } from '../shared/ideas';

const VALID_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'in_review',
  'approved',
  'accepted',
  'rejected',
  'in_progress',
  'completed',
  'done',
  'archived',
];

export default endpoint('idea-status-update', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as {
    ideaId?: unknown;
    status?: unknown;
    adminNotes?: unknown;
    rejectionReason?: unknown;
  };
  const { ideaId, status, adminNotes, rejectionReason } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) {
    return reply(400, {
      error: `status must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }
  if (adminNotes !== undefined && adminNotes !== null && typeof adminNotes !== 'string') {
    return reply(400, { error: 'adminNotes must be a string or null' });
  }
  if (rejectionReason !== undefined && rejectionReason !== null && typeof rejectionReason !== 'string') {
    return reply(400, { error: 'rejectionReason must be a string or null' });
  }

  const idea = await loadIdea(ideaId);
  if (!idea) return reply(404, { error: 'Idea not found' });

  await requireOrgAdmin(idea.org_id);

  const params: unknown[] = [];
  const setClauses: string[] = [];

  params.push(status);
  setClauses.push(`status = $${params.length}`);

  if (adminNotes !== undefined) {
    params.push(adminNotes);
    setClauses.push(`admin_notes = $${params.length}`);
  }

  params.push(status === 'rejected' ? (rejectionReason ?? null) : null);
  setClauses.push(`rejection_reason = $${params.length}`);

  params.push(ideaId);
  const idIndex = params.length;

  const updatedIdea = await queryOne(
    `UPDATE ideas SET ${setClauses.join(', ')} WHERE id = $${idIndex} RETURNING *`,
    params,
  );

  return reply(200, { idea: updatedIdea });
});
