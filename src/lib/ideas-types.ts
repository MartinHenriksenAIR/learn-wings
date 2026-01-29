// Ideas Hub Type Definitions

export type IdeaStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'in_progress' | 'completed' | 'archived';

export interface IdeaCategory {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  created_at: string;
}

export interface Idea {
  id: string;
  org_id: string;
  user_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  problem_statement: string | null;
  proposed_solution: string | null;
  expected_impact: string | null;
  status: IdeaStatus;
  course_context_id: string | null;
  lesson_context_id: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  // Joined fields
  profile?: {
    id: string;
    full_name: string;
    first_name: string | null;
    last_name: string | null;
    department: string | null;
  };
  category?: IdeaCategory;
  vote_count?: number;
  comment_count?: number;
  has_voted?: boolean;
}

export interface IdeaComment {
  id: string;
  idea_id: string;
  user_id: string;
  org_id: string;
  content: string;
  parent_comment_id: string | null;
  created_at: string;
  updated_at: string;
  profile?: {
    id: string;
    full_name: string;
    first_name: string | null;
    last_name: string | null;
  };
  replies?: IdeaComment[];
}

export interface IdeaVote {
  id: string;
  idea_id: string;
  user_id: string;
  org_id: string;
  created_at: string;
}

export interface IdeaEvaluation {
  id: string;
  idea_id: string;
  evaluated_by: string;
  value_score: number | null;
  complexity_score: number | null;
  notes: string | null;
  viability_assessment: string | null;
  created_at: string;
  updated_at: string;
  evaluator?: {
    id: string;
    full_name: string;
  };
}

export interface IdeaSpecification {
  id: string;
  idea_id: string;
  created_by: string;
  title: string;
  problem_definition: string | null;
  success_criteria: string | null;
  requirements: string | null;
  out_of_scope: string | null;
  dependencies: string | null;
  risks: string | null;
  estimated_effort: string | null;
  next_steps: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIConversation {
  id: string;
  user_id: string;
  org_id: string;
  context_type: 'ideas_hub' | 'course' | 'lesson';
  context_id: string | null;
  idea_id: string | null;
  messages: AIMessage[];
  created_at: string;
  updated_at: string;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Status display configuration
export const IDEA_STATUS_CONFIG: Record<IdeaStatus, { label: string; color: string; description: string }> = {
  draft: {
    label: 'Draft',
    color: 'bg-muted text-muted-foreground',
    description: 'Still being developed',
  },
  submitted: {
    label: 'Submitted',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    description: 'Awaiting review',
  },
  under_review: {
    label: 'Under Review',
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    description: 'Being evaluated',
  },
  approved: {
    label: 'Approved',
    color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    description: 'Accepted for development',
  },
  in_progress: {
    label: 'In Progress',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    description: 'Being implemented',
  },
  completed: {
    label: 'Completed',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    description: 'Successfully deployed',
  },
  archived: {
    label: 'Archived',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    description: 'Not proceeding',
  },
};
