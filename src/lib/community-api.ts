import { supabase } from '@/integrations/supabase/client';
import type { 
  CommunityPost, 
  CommunityComment, 
  CommunityCategory, 
  CommunityReport,
  CommunityScope,
  CreatePostInput,
  CreateCommentInput,
  CreateReportInput,
  PostFilters,
} from '@/lib/community-types';

// Fetch categories
export async function fetchCategories(): Promise<CommunityCategory[]> {
  const { data, error } = await supabase
    .from('community_categories')
    .select('*')
    .order('sort_order');

  if (error) throw error;
  return data as CommunityCategory[];
}

// Fetch posts with filters
export async function fetchPosts(filters: PostFilters): Promise<CommunityPost[]> {
  let query = supabase
    .from('community_posts')
    .select(`
      *,
      category:community_categories(*),
      profile:profiles!community_posts_user_id_fkey(id, full_name),
      organization:organizations(id, name)
    `)
    .eq('scope', filters.scope)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters.scope === 'org' && filters.org_id) {
    query = query.eq('org_id', filters.org_id);
  }

  if (filters.category_id) {
    query = query.eq('category_id', filters.category_id);
  }

  if (filters.search) {
    query = query.or(`title.ilike.%${filters.search}%,content.ilike.%${filters.search}%`);
  }

  if (filters.tags && filters.tags.length > 0) {
    query = query.overlaps('tags', filters.tags);
  }

  const { data, error } = await query;

  if (error) throw error;

  // Get comment counts
  const postIds = (data || []).map((p) => p.id);
  if (postIds.length > 0) {
    const { data: commentCounts } = await supabase
      .from('community_comments')
      .select('post_id')
      .in('post_id', postIds);

    const countMap = (commentCounts || []).reduce((acc, c) => {
      acc[c.post_id] = (acc[c.post_id] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return (data || []).map((p) => ({
      ...p,
      comment_count: countMap[p.id] || 0,
    })) as CommunityPost[];
  }

  return (data || []) as CommunityPost[];
}

// Fetch single post
export async function fetchPost(postId: string): Promise<CommunityPost | null> {
  const { data, error } = await supabase
    .from('community_posts')
    .select(`
      *,
      category:community_categories(*),
      profile:profiles!community_posts_user_id_fkey(id, full_name),
      organization:organizations(id, name)
    `)
    .eq('id', postId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return data as CommunityPost;
}

// Create post
export async function createPost(input: CreatePostInput): Promise<CommunityPost> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('community_posts')
    .insert({
      scope: input.scope,
      org_id: input.org_id || null,
      user_id: user.user.id,
      category_id: input.category_id,
      title: input.title,
      content: input.content,
      tags: input.tags || [],
      event_date: input.event_date || null,
      event_location: input.event_location || null,
      event_registration_url: input.event_registration_url || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as CommunityPost;
}

// Update post
export async function updatePost(
  postId: string, 
  updates: Partial<CommunityPost>
): Promise<CommunityPost> {
  const { data, error } = await supabase
    .from('community_posts')
    .update(updates)
    .eq('id', postId)
    .select()
    .single();

  if (error) throw error;
  return data as CommunityPost;
}

// Delete post
export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase
    .from('community_posts')
    .delete()
    .eq('id', postId);

  if (error) throw error;
}

// Fetch comments for a post
export async function fetchComments(postId: string): Promise<CommunityComment[]> {
  const { data, error } = await supabase
    .from('community_comments')
    .select(`
      *,
      profile:profiles!community_comments_user_id_fkey(id, full_name)
    `)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as CommunityComment[];
}

// Create comment
export async function createComment(input: CreateCommentInput): Promise<CommunityComment> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('community_comments')
    .insert({
      post_id: input.post_id,
      user_id: user.user.id,
      content: input.content,
      parent_comment_id: input.parent_comment_id || null,
    })
    .select(`
      *,
      profile:profiles!community_comments_user_id_fkey(id, full_name)
    `)
    .single();

  if (error) throw error;
  return data as CommunityComment;
}

// Update comment
export async function updateComment(
  commentId: string, 
  content: string
): Promise<CommunityComment> {
  const { data, error } = await supabase
    .from('community_comments')
    .update({ content })
    .eq('id', commentId)
    .select()
    .single();

  if (error) throw error;
  return data as CommunityComment;
}

// Delete comment
export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from('community_comments')
    .delete()
    .eq('id', commentId);

  if (error) throw error;
}

// Create report
export async function createReport(input: CreateReportInput): Promise<CommunityReport> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { data: existingReport, error: existingError } = await supabase
    .from('community_reports')
    .select('id')
    .eq('reporter_user_id', user.user.id)
    .eq('target_id', input.target_id)
    .eq('target_type', input.target_type)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existingReport) {
    throw new Error('You have already reported this content.');
  }

  const { data, error } = await supabase
    .from('community_reports')
    .insert({
      reporter_user_id: user.user.id,
      target_type: input.target_type,
      target_id: input.target_id,
      org_id: input.org_id || null,
      reason: input.reason,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('You have already reported this content.');
    }
    throw error;
  }
  return data as CommunityReport;
}

// Fetch reports (admin)
export async function fetchReports(orgId?: string): Promise<CommunityReport[]> {
  let query = supabase
    .from('community_reports')
    .select(`
      *,
      reporter:profiles!community_reports_reporter_user_id_fkey(id, full_name),
      reviewer:profiles!community_reports_reviewed_by_fkey(id, full_name)
    `)
    .order('created_at', { ascending: false });

  if (orgId) {
    query = query.eq('org_id', orgId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data || []) as CommunityReport[];
}

// Update report (admin)
export async function updateReport(
  reportId: string,
  updates: { status?: 'reviewed' | 'dismissed'; admin_notes?: string }
): Promise<CommunityReport> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('community_reports')
    .update({
      ...updates,
      reviewed_by: user.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', reportId)
    .select()
    .single();

  if (error) throw error;
  return data as CommunityReport;
}

// Toggle post visibility (admin)
export async function togglePostHidden(postId: string, hidden: boolean): Promise<void> {
  const { error } = await supabase
    .from('community_posts')
    .update({ is_hidden: hidden })
    .eq('id', postId);

  if (error) throw error;
}

// Toggle post lock (admin)
export async function togglePostLocked(postId: string, locked: boolean): Promise<void> {
  const { error } = await supabase
    .from('community_posts')
    .update({ is_locked: locked })
    .eq('id', postId);

  if (error) throw error;
}

// Toggle comment visibility (admin)
export async function toggleCommentHidden(commentId: string, hidden: boolean): Promise<void> {
  const { error } = await supabase
    .from('community_comments')
    .update({ is_hidden: hidden })
    .eq('id', commentId);

  if (error) throw error;
}
