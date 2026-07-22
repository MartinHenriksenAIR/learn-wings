import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PriorityOverview } from './PriorityOverview';
import type { EnhancedIdea } from '@/lib/community-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const idea = (over: Partial<EnhancedIdea>): EnhancedIdea => ({
  id: 'x', org_id: 'o', user_id: 'u', category_id: null, course_context_id: null,
  lesson_context_id: null, title: 'T', description: null, problem_statement: null,
  proposed_solution: null, expected_impact: null, status: 'accepted', submitted_at: null,
  created_at: '', updated_at: '', business_area: null, tags: [], current_process: null,
  pain_points: null, affected_roles: null, frequency_volume: null, proposed_improvement: null,
  desired_process: null, data_inputs: null, systems_involved: null, constraints_risks: null,
  success_metrics: null, admin_notes: null, rejection_reason: null, value_score: null,
  effort_score: null, ...over,
});

describe('PriorityOverview', () => {
  it('ranks scored ideas value desc → effort asc in the Do next list', () => {
    render(
      <PriorityOverview
        ideas={[
          idea({ id: 'a', title: 'Big bet', value_score: 3, effort_score: 3 }),
          idea({ id: 'b', title: 'Quick win', value_score: 3, effort_score: 1 }),
        ]}
      />,
    );
    const list = screen.getByTestId('do-next-list');
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Quick win');
    expect(items[1]).toHaveTextContent('Big bet');
  });
});
