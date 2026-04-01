// Community Module Type Definitions

import type { Profile, Organization } from './types';

// Enums
export type CommunityScope = 'org' | 'global';
export type ReportStatus = 'pending' | 'reviewed' | 'dismissed';
export type ReportTargetType = 'post' | 'comment';
export type BusinessArea = 'hr' | 'finance' | 'sales' | 'support' | 'ops' | 'it' | 'legal' | 'other';

// Extended idea status (includes new values)
export type IdeaStatusExtended = 
  | 'draft' 
  | 'submitted' 
  | 'under_review' 
  | 'in_review'
  | 'approved' 
  | 'accepted'
  | 'rejected'
  | 'in_progress' 
  | 'completed'
  | 'done'
  | 'archived';

// Category interface
export interface CommunityCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  is_restricted: boolean;
  sort_order: number;
  created_at: string;
}

// Post interface
export interface CommunityPost {
  id: string;
  scope: CommunityScope;
  org_id: string | null;
  user_id: string;
  category_id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  is_hidden: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
  // Joined relations
  category?: CommunityCategory;
  profile?: Profile;
  organization?: Organization;
  comment_count?: number;
}

// Comment interface
export interface CommunityComment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  parent_comment_id: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
  // Joined relations
  profile?: Profile;
  replies?: CommunityComment[];
}

// Report interface
export interface CommunityReport {
  id: string;
  reporter_user_id: string;
  target_type: ReportTargetType;
  target_id: string;
  org_id: string | null;
  reason: string;
  status: ReportStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_notes: string | null;
  created_at: string;
  // Joined relations
  reporter?: Profile;
  reviewer?: Profile;
  target_post?: CommunityPost;
  target_comment?: CommunityComment;
}

// Enhanced Idea interface (with new fields)
export interface EnhancedIdea {
  id: string;
  org_id: string;
  user_id: string;
  category_id: string | null;
  course_context_id: string | null;
  lesson_context_id: string | null;
  title: string;
  description: string | null;
  problem_statement: string | null;
  proposed_solution: string | null;
  expected_impact: string | null;
  status: IdeaStatusExtended;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  // New structured fields
  business_area: BusinessArea | null;
  tags: string[];
  current_process: string | null;
  pain_points: string | null;
  affected_roles: string | null;
  frequency_volume: string | null;
  proposed_improvement: string | null;
  desired_process: string | null;
  data_inputs: string | null;
  systems_involved: string | null;
  constraints_risks: string | null;
  success_metrics: string | null;
  // Admin-only fields
  admin_notes: string | null;
  rejection_reason: string | null;
  // Joined relations
  profile?: Profile;
  organization?: Organization;
  comment_count?: number;
  vote_count?: number;
  user_has_voted?: boolean;
}

// Business area options for forms
export const BUSINESS_AREAS: { value: BusinessArea; label: string }[] = [
  { value: 'hr', label: 'HR / People' },
  { value: 'finance', label: 'Finance / Accounting' },
  { value: 'sales', label: 'Sales' },
  { value: 'support', label: 'Customer Support' },
  { value: 'ops', label: 'Operations' },
  { value: 'it', label: 'IT / Technology' },
  { value: 'legal', label: 'Legal / Compliance' },
  { value: 'other', label: 'Other' },
];

// Idea status options for admin workflow
export const IDEA_STATUS_OPTIONS: { value: IdeaStatusExtended; label: string; color: string }[] = [
  { value: 'draft', label: 'Draft', color: 'bg-muted text-muted-foreground' },
  { value: 'submitted', label: 'Submitted', color: 'bg-blue-100 text-blue-800' },
  { value: 'in_review', label: 'In Review', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'accepted', label: 'Accepted', color: 'bg-green-100 text-green-800' },
  { value: 'rejected', label: 'Rejected', color: 'bg-red-100 text-red-800' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-purple-100 text-purple-800' },
  { value: 'done', label: 'Done', color: 'bg-emerald-100 text-emerald-800' },
];

// Form types
export interface CreatePostInput {
  scope: CommunityScope;
  org_id?: string;
  category_id: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface CreateCommentInput {
  post_id: string;
  content: string;
  parent_comment_id?: string;
}

export interface CreateReportInput {
  target_type: ReportTargetType;
  target_id: string;
  org_id?: string;
  reason: string;
}

export interface CreateIdeaInput {
  org_id: string;
  title: string;
  business_area?: BusinessArea;
  tags?: string[];
  current_process?: string;
  pain_points?: string;
  affected_roles?: string;
  frequency_volume?: string;
  proposed_improvement?: string;
  desired_process?: string;
  data_inputs?: string;
  systems_involved?: string;
  constraints_risks?: string;
  success_metrics?: string;
  // Legacy fields for compatibility
  description?: string;
  problem_statement?: string;
  proposed_solution?: string;
  expected_impact?: string;
}

export interface UpdateIdeaStatusInput {
  status: IdeaStatusExtended;
  admin_notes?: string;
  rejection_reason?: string;
}

// Filter types
export interface PostFilters {
  category_id?: string;
  tags?: string[];
  search?: string;
  scope: CommunityScope;
  org_id?: string;
}

export interface IdeaFilters {
  status?: IdeaStatusExtended[];
  business_area?: BusinessArea[];
  tags?: string[];
  search?: string;
  user_id?: string;
}
