import { callApi } from '@/lib/api-client';
import type {
  EnhancedIdea,
  CreateIdeaInput,
  UpdateIdeaStatusInput,
  IdeaComment,
  IdeaFilters,
} from '@/lib/community-types';

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

export async function fetchIdea(ideaId: string): Promise<EnhancedIdea | null> {
  const res = await callApi<{ idea: EnhancedIdea | null }>('/api/idea', { ideaId });
  return res.idea;
}

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

export async function updateIdea(
  ideaId: string,
  updates: Partial<CreateIdeaInput>
): Promise<EnhancedIdea> {
  const payload =
    updates.business_area !== undefined
      ? { ...updates, business_area: updates.business_area || null }
      : updates;
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-update', { ideaId, updates: payload });
  return res.idea;
}

export async function submitIdea(ideaId: string): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-submit', { ideaId });
  return res.idea;
}

export async function updateIdeaStatus(
  ideaId: string,
  input: UpdateIdeaStatusInput
): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-status-update', {
    ideaId,
    status: input.status,
    adminNotes: input.admin_notes,
    rejectionReason: input.rejection_reason,
  });
  return res.idea;
}

export async function updateIdeaPriority(
  ideaId: string,
  value: number | null,
  effort: number | null,
): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-prioritize', { ideaId, value, effort });
  return res.idea;
}

export async function deleteIdea(ideaId: string): Promise<void> {
  await callApi('/api/idea-delete', { ideaId });
}

export async function voteForIdea(ideaId: string): Promise<void> {
  await callApi('/api/idea-vote', { ideaId });
}

export async function removeVoteFromIdea(ideaId: string): Promise<void> {
  await callApi('/api/idea-vote-remove', { ideaId });
}

export async function fetchIdeaComments(ideaId: string): Promise<IdeaComment[]> {
  const res = await callApi<{ comments: IdeaComment[] }>('/api/idea-comments', { ideaId });
  return res.comments ?? [];
}

export async function createIdeaComment(
  ideaId: string,
  content: string,
  parentId?: string
): Promise<IdeaComment> {
  const res = await callApi<{ comment: IdeaComment }>('/api/idea-comment-create', {
    ideaId,
    content,
    parentCommentId: parentId,
  });
  return res.comment;
}

export async function fetchOrgTags(orgId: string): Promise<string[]> {
  const res = await callApi<{ tags: string[] }>('/api/idea-tags', { orgId });
  return (res.tags ?? []).sort((a, b) => a.localeCompare(b));
}
