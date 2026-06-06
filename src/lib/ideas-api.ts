import { callApi } from '@/lib/api-client';
import type {
  EnhancedIdea,
  CreateIdeaInput,
  UpdateIdeaStatusInput,
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
export async function createIdea(input: CreateIdeaInput): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-create', {
    orgId: input.org_id,
    title: input.title,
    business_area: input.business_area,
    tags: input.tags,
    current_process: input.current_process,
    pain_points: input.pain_points,
    affected_roles: input.affected_roles,
    frequency_volume: input.frequency_volume,
    proposed_improvement: input.proposed_improvement,
    desired_process: input.desired_process,
    data_inputs: input.data_inputs,
    systems_involved: input.systems_involved,
    constraints_risks: input.constraints_risks,
    success_metrics: input.success_metrics,
    description: input.description,
    problem_statement: input.problem_statement,
    proposed_solution: input.proposed_solution,
    expected_impact: input.expected_impact,
  });
  return res.idea;
}

// Update idea (draft only for authors)
export async function updateIdea(
  ideaId: string,
  updates: Partial<CreateIdeaInput>
): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-update', { ideaId, updates });
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

// Delete idea (draft only)
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchIdeaComments(ideaId: string): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await callApi<{ comments: any[] }>('/api/idea-comments', { ideaId });
  return res.comments ?? [];
}

// Create idea comment — orgId kept for signature compatibility; server derives org from the idea row
export async function createIdeaComment(
  ideaId: string,
  orgId: string,
  content: string,
  parentId?: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await callApi<{ comment: any }>('/api/idea-comment-create', {
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
