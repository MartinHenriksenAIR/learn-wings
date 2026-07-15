import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

// idea_status enum values (provenance: supabase enum idea_status).
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

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

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

  // Load idea
  const idea = await queryOne<IdeaRow>(
    `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
    [ideaId],
  );
  if (!idea) return reply(404, { error: 'Idea not found' });

  // Authorization: platform admin OR org admin of the IDEA's org (never client-supplied).
  // Authorship grants nothing here; status writes are admin-only.
  await requireOrgAdmin(idea.org_id);

  // Build whitelist-only dynamic UPDATE (supabase-js parity):
  //   status              — always set
  //   admin_notes         — only when adminNotes !== undefined (explicit null clears)
  //   rejection_reason    — ALWAYS set: 'rejected' ? (rejectionReason ?? null) : null
  // submitted_at (idea-submit only) and updated_at (DB trigger) are untouched.
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
