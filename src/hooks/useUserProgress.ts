import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface ModuleProgress {
  id: string;
  title: string;
  sortOrder: number;
  lessons: UserLessonProgress[];
}

interface UserLessonProgress {
  id: string;
  title: string;
  lessonType: string;
  sortOrder: number;
  status: 'not_started' | 'in_progress' | 'completed';
  completedAt: string | null;
  quizId?: string;
  latestQuizScore?: number;
  latestQuizPassed?: boolean;
}

interface QuizAttemptData {
  id: string;
  quizId: string;
  lessonTitle: string;
  score: number;
  passed: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface CourseProgress {
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  courseLevel: string;
  enrollmentStatus: string;
  enrolledAt: string;
  completedAt: string | null;
  modules: ModuleProgress[];
  totalLessons: number;
  completedLessons: number;
  quizAttempts: QuizAttemptData[];
}

interface UserProgressResult {
  courses: CourseProgress[];
}

interface UseUserProgressOptions {
  enabled?: boolean;
  staleTime?: number;
}

export function useUserProgress(
  orgId: string | undefined,
  userId: string | undefined,
  options: UseUserProgressOptions = {},
) {
  return useQuery({
    queryKey: queryKeys.userProgress.detail(orgId, userId),
    queryFn: async () => {
      const data = await callApi<UserProgressResult>('/api/user-progress', { orgId, userId });
      return data;
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId && !!userId,
  });
}
