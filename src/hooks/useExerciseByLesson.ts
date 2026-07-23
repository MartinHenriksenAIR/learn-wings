import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Exercise } from '@/lib/types';

interface ExerciseByLessonResult { exercise: Exercise | null; }
interface Options { enabled?: boolean; }

/** The one way to fetch /api/exercise-by-lesson (learner, full config incl. answers). */
export function useExerciseByLesson(lessonId: string | undefined, options: Options = {}) {
  return useQuery({
    queryKey: queryKeys.exerciseByLesson.detail(lessonId),
    queryFn: () => callApi<ExerciseByLessonResult>('/api/exercise-by-lesson', { lessonId }),
    enabled: (options.enabled ?? true) && !!lessonId,
    staleTime: 60 * 1000,
  });
}
