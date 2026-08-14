import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Exercise } from '@/lib/types';

interface ExerciseAdminResult { exercise: Exercise | null; }
interface Options { enabled?: boolean; }

export function useExerciseAdmin(lessonId: string | undefined, options: Options = {}) {
  return useQuery({
    queryKey: queryKeys.exerciseAdmin.detail(lessonId ?? ''),
    queryFn: () => callApi<ExerciseAdminResult>('/api/exercise-admin', { lessonId }),
    enabled: (options.enabled ?? true) && !!lessonId,
  });
}
