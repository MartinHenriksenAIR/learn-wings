// AIR Academy Type Definitions

export type OrgRole = 'org_admin' | 'learner';
type MembershipStatus = 'active' | 'invited' | 'disabled';
type InvitationStatus = 'pending' | 'accepted' | 'expired';
export type CourseLevel = 'basic' | 'intermediate' | 'advanced';
export type LessonType = 'video' | 'document' | 'quiz' | 'exercise';
type EnrollmentStatus = 'enrolled' | 'completed';
type ProgressStatus = 'not_started' | 'in_progress' | 'completed';
type AccessType = 'enabled' | 'disabled';

export interface Profile {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  email: string | null;
  avatar_url: string | null;
  is_platform_admin: boolean;
  created_at: string;
  preferred_language: string | null;
  assessment_level: CourseLevel | null;
  assessment_skipped_at: string | null;
  assessment_taken_at: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  seat_limit: number | null;
  created_at: string;
  member_count?: number;
  pending_invite_count?: number;
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
  language: 'en' | 'da' | null;
  course_group_id: string | null;
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

// ── Exercises (ADR-0017) — ungraded interactive lessons ──────────────────────
export type ExerciseKind = 'quick_check' | 'bucket_sort';

export interface QuickCheckOption { id: string; text: string; correct: boolean; }
export interface QuickCheckQuestion { id: string; text: string; options: QuickCheckOption[]; }
export interface QuickCheckConfig { version: 1; questions: QuickCheckQuestion[]; }

export interface BucketSortBucket { id: string; label: string; }
export interface BucketSortItem { id: string; text: string; bucketId: string; }
export interface BucketSortConfig { version: 1; buckets: BucketSortBucket[]; items: BucketSortItem[]; }

export type ExerciseConfig = QuickCheckConfig | BucketSortConfig;

export interface Exercise {
  id: string;
  lesson_id: string;
  exercise_kind: ExerciseKind;
  config: ExerciseConfig;
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

interface CourseProgressSummary {
  courseId: string;
  courseTitle: string;
  enrolledCount: number;
  completedCount: number;
  completionRate: number;
  avgProgress: number;
}

interface OrgAnalyticsSummary {
  orgId: string;
  orgName: string;
  totalUsers: number;
  activeUsers: number;
  completionRate: number;
}

// Seat requests (issue #127)
export type SeatRequestStatus = 'pending' | 'fulfilled' | 'cancelled';

export interface SeatRequest {
  id: string;
  org_id: string;
  requested_by_user_id: string | null;
  additional_seats: number;
  unit_price_snapshot: number;
  currency: string;
  status: SeatRequestStatus;
  created_at: string;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
}

export interface SeatPricing {
  annual_price_per_seat: number | null;
  currency: string;
}
