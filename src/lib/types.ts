// AIR Academy Type Definitions

export type OrgRole = 'org_admin' | 'learner';
export type MembershipStatus = 'active' | 'invited' | 'disabled';
export type InvitationStatus = 'pending' | 'accepted' | 'expired';
export type CourseLevel = 'basic' | 'intermediate' | 'advanced';
export type LessonType = 'video' | 'document' | 'quiz';
export type EnrollmentStatus = 'enrolled' | 'completed';
export type ProgressStatus = 'not_started' | 'in_progress' | 'completed';
export type AccessType = 'enabled' | 'disabled';

export interface Profile {
  id: string;
  full_name: string;
  is_platform_admin: boolean;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  seat_limit: number | null;
  created_at: string;
}

export interface OrgMembership {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  status: MembershipStatus;
  created_at: string;
  organization?: Organization;
  profile?: Profile;
}

export interface Invitation {
  id: string;
  org_id: string | null;
  email: string;
  role: OrgRole;
  token: string;
  link_id: string;
  status: InvitationStatus;
  invited_by_user_id: string | null;
  created_at: string;
  expires_at: string;
  is_platform_admin_invite: boolean;
  organization?: Organization;
}

export interface Course {
  id: string;
  title: string;
  description: string | null;
  level: CourseLevel;
  is_published: boolean;
  thumbnail_url: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
  lessons?: Lesson[];
}

export interface Lesson {
  id: string;
  module_id: string;
  title: string;
  lesson_type: LessonType;
  content_text: string | null;
  video_storage_path: string | null;
  video_url: string | null;
  document_storage_path: string | null;
  azure_blob_path: string | null;
  sort_order: number;
  duration_minutes: number | null;
  quiz?: Quiz;
}

export interface Quiz {
  id: string;
  lesson_id: string;
  passing_score: number;
  questions?: QuizQuestion[];
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  question_text: string;
  sort_order: number;
  options?: QuizOption[];
}

export interface QuizOption {
  id: string;
  question_id: string;
  option_text: string;
  is_correct: boolean;
}

export interface OrgCourseAccess {
  id: string;
  org_id: string;
  course_id: string;
  access: AccessType;
  created_at: string;
}

export interface Enrollment {
  id: string;
  org_id: string;
  user_id: string;
  course_id: string;
  status: EnrollmentStatus;
  enrolled_at: string;
  completed_at: string | null;
  course?: Course;
  profile?: Profile;
}

export interface LessonProgress {
  id: string;
  org_id: string;
  user_id: string;
  lesson_id: string;
  status: ProgressStatus;
  completed_at: string | null;
}

export interface QuizAttempt {
  id: string;
  org_id: string;
  user_id: string;
  quiz_id: string;
  score: number;
  passed: boolean;
  started_at: string;
  finished_at: string | null;
}

export interface CourseReview {
  id: string;
  org_id: string;
  user_id: string;
  course_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

// User context
export interface UserContext {
  profile: Profile | null;
  memberships: OrgMembership[];
  currentOrg: Organization | null;
  isPlatformAdmin: boolean;
  isOrgAdmin: boolean;
  isLoading: boolean;
}

// Analytics types
export interface OrgAnalytics {
  totalUsers: number;
  activeUsers7Days: number;
  activeUsers30Days: number;
  totalEnrollments: number;
  completedEnrollments: number;
  completionRate: number;
  avgQuizScore: number;
  courseProgress: CourseProgressSummary[];
}

export interface CourseProgressSummary {
  courseId: string;
  courseTitle: string;
  enrolledCount: number;
  completedCount: number;
  completionRate: number;
  avgProgress: number;
}

export interface PlatformAnalytics extends OrgAnalytics {
  totalOrganizations: number;
  orgBreakdown: OrgAnalyticsSummary[];
}

export interface OrgAnalyticsSummary {
  orgId: string;
  orgName: string;
  totalUsers: number;
  activeUsers: number;
  completionRate: number;
}
