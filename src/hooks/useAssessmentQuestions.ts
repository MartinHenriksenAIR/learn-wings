import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface AssessmentQuestion {
  id: string;
  options: string[];
}

export interface AssessmentQuestionsData {
  version: string;
  questions: AssessmentQuestion[];
}

/**
 * The one way to fetch `/api/assessment-questions` from the frontend.
 *
 * Questions are fixed content — the server returns a versioned questionnaire
 * that does not change during a session. A 5-minute staleTime avoids redundant
 * refetches while still picking up a server-side version bump on the next mount.
 */
export function useAssessmentQuestions() {
  return useQuery({
    queryKey: queryKeys.assessment.questions(),
    queryFn: async () => {
      const data = await callApi<AssessmentQuestionsData>('/api/assessment-questions', {});
      return {
        version: data.version,
        questions: Array.isArray(data.questions) ? data.questions : [],
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
