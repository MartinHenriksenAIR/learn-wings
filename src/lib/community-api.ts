import { callApi } from '@/lib/api-client';
import type {
  CommunityPost,
  CommunityComment,
  CommunityCategory,
  CommunityReport,
  CreatePostInput,
  CreateCommentInput,
  CreateReportInput,
  PostFilters,
  ReportStatus,
} from '@/lib/community-types';

// Fetch categories
export async function fetchCategories(): Promise<CommunityCategory[]> {
  const res = await callApi<{ categories: CommunityCategory[] }>('/api/community-categories', {});
  return res.categories;
}

// Fetch posts with filters
export async function fetchPosts(filters: PostFilters): Promise<CommunityPost[]> {
  const res = await callApi<{ posts: CommunityPost[] }>('/api/community-posts', {
    scope: filters.scope,
    orgId: filters.scope === 'org' ? filters.org_id : undefined,
    categoryId: filters.category_id,
    search: filters.search,
    tags: filters.tags,
  });
  return res.posts;
}

// Fetch single post
export async function fetchPost(postId: string): Promise<CommunityPost | null> {
  const res = await callApi<{ post: CommunityPost | null }>('/api/community-post', { postId });
  return res.post;
}

// Create post
export async function createPost(input: CreatePostInput): Promise<CommunityPost> {
  const res = await callApi<{ post: CommunityPost }>('/api/community-post-create', {
    scope: input.scope,
    orgId: input.scope === 'org' ? input.org_id : undefined,
    categoryId: input.category_id,
    title: input.title,
    content: input.content,
    tags: input.tags || [],
    eventDate: input.event_date || null,
    eventLocation: input.event_location || null,
    eventRegistrationUrl: input.event_registration_url || null,
  });
  return res.post;
}

// Update post
export async function updatePost(
  postId: string,
  updates: Partial<CommunityPost>
): Promise<CommunityPost> {
  const payload: Record<string, unknown> = {};
  const allowedKeys = [
    'category_id',
    'title',
    'content',
    'tags',
    'event_date',
    'event_location',
    'event_registration_url',
  ] as const;
  for (const key of allowedKeys) {
    if (updates[key] !== undefined) {
      payload[key] = updates[key];
    }
  }
  const res = await callApi<{ post: CommunityPost }>('/api/community-post-update', {
    postId,
    updates: payload,
  });
  return res.post;
}

// Delete post
export async function deletePost(postId: string): Promise<void> {
  await callApi('/api/community-post-delete', { postId });
}

// Fetch comments for a post
export async function fetchComments(postId: string): Promise<CommunityComment[]> {
  const res = await callApi<{ comments: CommunityComment[] }>('/api/community-comments', { postId });
  return res.comments;
}

// Create comment
export async function createComment(input: CreateCommentInput): Promise<CommunityComment> {
  const res = await callApi<{ comment: CommunityComment }>('/api/community-comment-create', {
    postId: input.post_id,
    content: input.content,
    parentCommentId: input.parent_comment_id ?? undefined,
  });
  return res.comment;
}

// Update comment
export async function updateComment(
  commentId: string,
  content: string
): Promise<CommunityComment> {
  const res = await callApi<{ comment: CommunityComment }>('/api/community-comment-update', {
    commentId,
    content,
  });
  return res.comment;
}

// Delete comment
export async function deleteComment(commentId: string): Promise<void> {
  await callApi('/api/community-comment-delete', { commentId });
}

// Create report
export async function createReport(input: CreateReportInput): Promise<CommunityReport> {
  const res = await callApi<{ report: CommunityReport }>('/api/community-report-create', {
    targetType: input.target_type,
    targetId: input.target_id,
    orgId: input.org_id ?? null,
    reason: input.reason,
  });
  return res.report;
}

// Fetch reports (admin)
export async function fetchReports(
  orgId?: string,
  opts?: { scope?: 'global'; status?: ReportStatus }
): Promise<CommunityReport[]> {
  const res = await callApi<{ reports: CommunityReport[] }>('/api/community-reports', {
    orgId,
    scope: opts?.scope,
    status: opts?.status,
  });
  return res.reports;
}

// Update report (admin)
export async function updateReport(
  reportId: string,
  updates: { status?: 'reviewed' | 'dismissed'; admin_notes?: string | null }
): Promise<CommunityReport> {
  const res = await callApi<{ report: CommunityReport }>('/api/community-report-update', {
    reportId,
    status: updates.status,
    adminNotes: updates.admin_notes,
  });
  return res.report;
}

// Toggle post visibility (admin)
export async function togglePostHidden(postId: string, hidden: boolean): Promise<void> {
  await callApi('/api/community-post-moderate', { postId, isHidden: hidden });
}

// Toggle post lock (admin)
export async function togglePostLocked(postId: string, locked: boolean): Promise<void> {
  await callApi('/api/community-post-moderate', { postId, isLocked: locked });
}

// Toggle comment visibility (admin)
export async function toggleCommentHidden(commentId: string, hidden: boolean): Promise<void> {
  await callApi('/api/community-comment-moderate', { commentId, isHidden: hidden });
}
