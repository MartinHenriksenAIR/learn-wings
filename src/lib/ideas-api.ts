import { supabase } from '@/integrations/supabase/client';
import type { 
  EnhancedIdea, 
  CreateIdeaInput, 
  UpdateIdeaStatusInput,
  IdeaFilters,
  IdeaStatusExtended,
} from '@/lib/community-types';

// Fetch ideas with filters
export async function fetchIdeas(orgId: string, filters?: IdeaFilters): Promise<EnhancedIdea[]> {
  let query = supabase
    .from('ideas')
    .select(`
      *,
      profile:profiles!ideas_user_id_fkey(id, full_name)
    `)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (filters?.status && filters.status.length > 0) {
    query = query.in('status', filters.status);
  }

  if (filters?.business_area && filters.business_area.length > 0) {
    query = query.in('business_area', filters.business_area);
  }

  if (filters?.user_id) {
    query = query.eq('user_id', filters.user_id);
  }

  if (filters?.search) {
    query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%,pain_points.ilike.%${filters.search}%`);
  }

  if (filters?.tags && filters.tags.length > 0) {
    query = query.overlaps('tags', filters.tags);
  }

  const { data, error } = await query;

  if (error) throw error;

  // Get comment and vote counts
  const ideaIds = (data || []).map((i) => i.id);
  if (ideaIds.length > 0) {
    const [{ data: commentCounts }, { data: voteCounts }] = await Promise.all([
      supabase.from('idea_comments').select('idea_id').in('idea_id', ideaIds),
      supabase.from('idea_votes').select('idea_id').in('idea_id', ideaIds),
    ]);

    const commentMap = (commentCounts || []).reduce((acc, c) => {
      acc[c.idea_id] = (acc[c.idea_id] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const voteMap = (voteCounts || []).reduce((acc, v) => {
      acc[v.idea_id] = (acc[v.idea_id] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return (data || []).map((i) => ({
      ...i,
      comment_count: commentMap[i.id] || 0,
      vote_count: voteMap[i.id] || 0,
    })) as EnhancedIdea[];
  }

  return (data || []) as EnhancedIdea[];
}

// Fetch single idea
export async function fetchIdea(ideaId: string): Promise<EnhancedIdea | null> {
  const { data, error } = await supabase
    .from('ideas')
    .select(`
      *,
      profile:profiles!ideas_user_id_fkey(id, full_name),
      organization:organizations!ideas_org_id_fkey(id, name)
    `)
    .eq('id', ideaId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  // Get counts
  const [{ data: comments }, { data: votes }, { data: userVote }] = await Promise.all([
    supabase.from('idea_comments').select('id').eq('idea_id', ideaId),
    supabase.from('idea_votes').select('id').eq('idea_id', ideaId),
    supabase.from('idea_votes').select('id').eq('idea_id', ideaId).eq('user_id', (await supabase.auth.getUser()).data.user?.id || ''),
  ]);

  return {
    ...data,
    comment_count: comments?.length || 0,
    vote_count: votes?.length || 0,
    user_has_voted: (userVote?.length || 0) > 0,
  } as EnhancedIdea;
}

// Create idea
export async function createIdea(input: CreateIdeaInput): Promise<EnhancedIdea> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ideas')
    .insert({
      org_id: input.org_id,
      user_id: user.user.id,
      title: input.title,
      status: 'draft',
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
    })
    .select()
    .single();

  if (error) throw error;
  return data as EnhancedIdea;
}

// Update idea (draft only for authors)
export async function updateIdea(
  ideaId: string, 
  updates: Partial<CreateIdeaInput>
): Promise<EnhancedIdea> {
  const { data, error } = await supabase
    .from('ideas')
    .update(updates)
    .eq('id', ideaId)
    .select()
    .single();

  if (error) throw error;
  return data as EnhancedIdea;
}

// Submit idea (change from draft to submitted)
export async function submitIdea(ideaId: string): Promise<EnhancedIdea> {
  const { data, error } = await supabase
    .from('ideas')
    .update({ 
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', ideaId)
    .select()
    .single();

  if (error) throw error;
  return data as EnhancedIdea;
}

// Update idea status (admin only)
export async function updateIdeaStatus(
  ideaId: string, 
  input: UpdateIdeaStatusInput
): Promise<EnhancedIdea> {
  const { data, error } = await supabase
    .from('ideas')
    .update({
      status: input.status,
      admin_notes: input.admin_notes,
      rejection_reason: input.status === 'rejected' ? input.rejection_reason : null,
    })
    .eq('id', ideaId)
    .select()
    .single();

  if (error) throw error;
  return data as EnhancedIdea;
}

// Delete idea (draft only)
export async function deleteIdea(ideaId: string): Promise<void> {
  const { error } = await supabase
    .from('ideas')
    .delete()
    .eq('id', ideaId);

  if (error) throw error;
}

// Vote for idea
export async function voteForIdea(ideaId: string, orgId: string): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('idea_votes')
    .insert({
      idea_id: ideaId,
      org_id: orgId,
      user_id: user.user.id,
    });

  if (error) throw error;
}

// Remove vote from idea
export async function removeVoteFromIdea(ideaId: string): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('idea_votes')
    .delete()
    .eq('idea_id', ideaId)
    .eq('user_id', user.user.id);

  if (error) throw error;
}

// Fetch idea comments
export async function fetchIdeaComments(ideaId: string) {
  const { data, error } = await supabase
    .from('idea_comments')
    .select(`
      *,
      profile:profiles!idea_comments_user_id_fkey(id, full_name)
    `)
    .eq('idea_id', ideaId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Create idea comment
export async function createIdeaComment(
  ideaId: string, 
  orgId: string,
  content: string, 
  parentId?: string
) {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('idea_comments')
    .insert({
      idea_id: ideaId,
      org_id: orgId,
      user_id: user.user.id,
      content,
      parent_comment_id: parentId || null,
    })
    .select(`
      *,
      profile:profiles!idea_comments_user_id_fkey(id, full_name)
    `)
    .single();

  if (error) throw error;
  return data;
}

// Fetch unique tags used by ideas in an organization
export async function fetchOrgTags(orgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('ideas')
    .select('tags')
    .eq('org_id', orgId);

  if (error) throw error;

  const tagSet = new Set<string>();
  (data || []).forEach((row: any) => {
    (row.tags || []).forEach((tag: string) => {
      if (tag) tagSet.add(tag);
    });
  });

  return [...tagSet].sort((a, b) => a.localeCompare(b));
}
