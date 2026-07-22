import { callApi } from '@/lib/api-client';
import type {
  EnhancedIdea,
  CreateIdeaInput,
  UpdateIdeaStatusInput,
  IdeaComment,
  IdeaFilters,
} from '@/lib/community-types';

// Fetch ideas with filters
export async function fetchIdeas(orgId: string, filters?: IdeaFilters): Promise<EnhancedIdea[]> {
  const res = await callApi<{ ideas: EnhancedIdea[] }>('/api/ideas', {
    orgId,
    status: filters?.status,
    businessArea: filters?.business_area,
    tags: filters?.tags,
    search: filters?.search,
    userId: filters?.user_id,
  });
  return (res.ideas ?? []) as EnhancedIdea[];
}

// Fetch single idea
export async function fetchIdea(ideaId: string): Promise<EnhancedIdea | null> {
  const res = await callApi<{ idea: EnhancedIdea | null }>('/api/idea', { ideaId });
  return res.idea;
}

// Create idea
// `|| null` coercions are old-lib parity: IdeaSubmit's form defaults every field
// to '' (incl. business_area, a PG enum server-side) — '' would 400 the endpoint's
// enum validation, and the old client lib stored null, not ''.
export async function createIdea(input: CreateIdeaInput): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-create', {
    orgId: input.org_id,
    title: input.title,
    business_area: input.business_area || null,
    tags: input.tags || [],
    current_process: input.current_process || null,
    pain_points: input.pain_points || null,
    affected_roles: input.affected_roles || null,
    frequency_volume: input.frequency_volume || null,
    proposed_improvement: input.proposed_improvement || null,
    desired_process: input.desired_process || null,
    data_inputs: input.data_inputs || null,
    systems_involved: input.systems_involved || null,
    constraints_risks: input.constraints_risks || null,
    success_metrics: input.success_metrics || null,
    description: input.description || null,
    problem_statement: input.problem_statement || null,
    proposed_solution: input.proposed_solution || null,
    expected_impact: input.expected_impact || null,
  });
  return res.idea;
}

// Update idea (draft only for authors)
export async function updateIdea(
  ideaId: string,
  updates: Partial<CreateIdeaInput>
): Promise<EnhancedIdea> {
  // The form's unselected business-area <Select> sends '' — a PG enum server-side;
  // coerce to null ('' would 400 the endpoint's enum validation). Other fields stay
  // verbatim (old-lib update behavior).
  const payload =
    updates.business_area !== undefined
      ? { ...updates, business_area: updates.business_area || null }
      : updates;
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-update', { ideaId, updates: payload });
  return res.idea;
}

// Submit idea (change from draft to submitted)
export async function submitIdea(ideaId: string): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-submit', { ideaId });
  return res.idea;
}

// Update idea status (admin only)
export async function updateIdeaStatus(
  ideaId: string,
  input: UpdateIdeaStatusInput
): Promise<EnhancedIdea> {
  // adminNotes absent (undefined) is intentional: JSON.stringify drops undefined keys — leave column untouched
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-status-update', {
    ideaId,
    status: input.status,
    adminNotes: input.admin_notes,
    rejectionReason: input.rejection_reason,
  });
  return res.idea;
}

// Set (or clear) an idea's Value/Effort prioritization scores (admin only).
// value/effort are 1-3 (Low/Med/High) or null to clear. Server derives org from the idea row.
export async function updateIdeaPriority(
  ideaId: string,
  value: number | null,
  effort: number | null,
): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-prioritize', { ideaId, value, effort });
  return res.idea;
}

// Delete idea — authors may delete their own ideas of ANY status; org admins may
// delete any idea in their org (RLS provenance: migration 20260202140817 replaced
// the draft-only policy with author-any-status + org-admin DELETE policies).
export async function deleteIdea(ideaId: string): Promise<void> {
  await callApi('/api/idea-delete', { ideaId });
}

// Vote for idea — orgId kept for signature compatibility; server derives org from the idea row
export async function voteForIdea(ideaId: string, orgId: string): Promise<void> {
  await callApi('/api/idea-vote', { ideaId, orgId });
}

// Remove vote from idea
export async function removeVoteFromIdea(ideaId: string): Promise<void> {
  await callApi('/api/idea-vote-remove', { ideaId });
}

// Fetch idea comments
export async function fetchIdeaComments(ideaId: string): Promise<IdeaComment[]> {
  const res = await callApi<{ comments: IdeaComment[] }>('/api/idea-comments', { ideaId });
  return res.comments ?? [];
}

// Create idea comment — orgId kept for signature compatibility; server derives org from the idea row
export async function createIdeaComment(
  ideaId: string,
  orgId: string,
  content: string,
  parentId?: string
): Promise<IdeaComment> {
  const res = await callApi<{ comment: IdeaComment }>('/api/idea-comment-create', {
    ideaId,
    content,
    parentCommentId: parentId,
    orgId,
  });
  return res.comment;
}

// Fetch unique tags used by ideas in an organization
// Client-side localeCompare sort kept for parity: SQL ASC collation can differ for non-ASCII chars (e.g. æøå)
export async function fetchOrgTags(orgId: string): Promise<string[]> {
  const res = await callApi<{ tags: string[] }>('/api/idea-tags', { orgId });
  return (res.tags ?? []).sort((a, b) => a.localeCompare(b));
}
