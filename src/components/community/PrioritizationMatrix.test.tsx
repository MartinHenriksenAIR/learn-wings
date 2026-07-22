import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrioritizationMatrix } from './PrioritizationMatrix';
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

describe('PrioritizationMatrix', () => {
  it('shows only accepted + in_progress ideas', () => {
    render(
      <PrioritizationMatrix
        ideas={[
          idea({ id: 'a', title: 'Accepted one', status: 'accepted' }),
          idea({ id: 'b', title: 'Wip one', status: 'in_progress' }),
          idea({ id: 'c', title: 'Inbox one', status: 'submitted' }),
          idea({ id: 'd', title: 'Done one', status: 'done' }),
        ]}
        onScore={vi.fn()}
      />,
    );
    expect(screen.getByText('Accepted one')).toBeInTheDocument();
    expect(screen.getByText('Wip one')).toBeInTheDocument();
    expect(screen.queryByText('Inbox one')).not.toBeInTheDocument();
    expect(screen.queryByText('Done one')).not.toBeInTheDocument();
  });

  it('puts unscored in-scope ideas in the unscored tray', () => {
    render(
      <PrioritizationMatrix
        ideas={[idea({ id: 'u', title: 'Needs score', status: 'accepted', value_score: null, effort_score: null })]}
        onScore={vi.fn()}
      />,
    );
    const tray = screen.getByTestId('unscored-tray');
    expect(tray).toHaveTextContent('Needs score');
  });

  it('places a scored idea in the matching grid cell', () => {
    render(
      <PrioritizationMatrix
        ideas={[idea({ id: 's', title: 'Quick win idea', status: 'accepted', value_score: 3, effort_score: 1 })]}
        onScore={vi.fn()}
      />,
    );
    // cell test id encodes value/effort: cell-<value>-<effort>
    const cell = screen.getByTestId('cell-3-1');
    expect(cell).toHaveTextContent('Quick win idea');
  });
});
