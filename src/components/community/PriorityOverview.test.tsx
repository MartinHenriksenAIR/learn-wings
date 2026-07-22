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

  it('aggregates scored ideas into the four quadrant bands; unscored ignored', () => {
    render(
      <PriorityOverview
        ideas={[
          idea({ id: 'qw1', value_score: 3, effort_score: 1 }), // quick_win
          idea({ id: 'qw2', value_score: 2, effort_score: 2 }), // quick_win
          idea({ id: 'bb', value_score: 3, effort_score: 3 }),  // big_bet
          idea({ id: 'fi', value_score: 1, effort_score: 1 }),  // fill_in
          idea({ id: 'dp', value_score: 1, effort_score: 3 }),  // deprioritize
          idea({ id: 'un', value_score: null, effort_score: null }), // ignored
        ]}
      />,
    );
    expect(screen.getByTestId('band-count-quick_win')).toHaveTextContent('2');
    expect(screen.getByTestId('band-count-big_bet')).toHaveTextContent('1');
    expect(screen.getByTestId('band-count-fill_in')).toHaveTextContent('1');
    expect(screen.getByTestId('band-count-deprioritize')).toHaveTextContent('1');
  });

  it('rolls up by business area: null ignored, count>0 only, sorted desc', () => {
    render(
      <PriorityOverview
        ideas={[
          idea({ id: 's1', business_area: 'sales' }),
          idea({ id: 's2', business_area: 'sales' }),
          idea({ id: 's3', business_area: 'sales' }),
          idea({ id: 'h1', business_area: 'hr' }),
          idea({ id: 'n1', business_area: null }), // ignored
          idea({ id: 'n2', business_area: null }), // ignored
        ]}
      />,
    );
    const list = screen.getByTestId('business-area-list');
    const rows = within(list).getAllByRole('listitem');
    // only the two areas with ideas appear (count>0 filter drops the other 6),
    // and null-area ideas never create a row
    expect(rows).toHaveLength(2);
    // sorted by count desc: Sales (3) before HR / People (1)
    expect(rows[0]).toHaveTextContent('Sales');
    expect(rows[1]).toHaveTextContent('HR / People');
  });
});
