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

export function useAssessmentQuestions() {
  return useQuery({
    queryKey: queryKeys.assessment.questions,
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
