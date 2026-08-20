import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatDate } from '@/lib/date-locale';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const mockUseLearnerAssignments = vi.fn();
vi.mock('@/hooks/useLearnerAssignments', () => ({
  useLearnerAssignments: (...args: unknown[]) => mockUseLearnerAssignments(...args),
}));

import { MandatoryCourses } from './MandatoryCourses';
import type { LearnerAssignment } from '@/lib/types';

const base: LearnerAssignment = {
  courseId: 'c-1', courseTitle: 'Compliance 101', thumbnailUrl: null,
  mandatory: true, dueDate: '2026-09-01', overdue: false, completed: false,
  assignedByOrgId: 'org-1',
};
const overdue: LearnerAssignment = {
  ...base, courseId: 'c-2', courseTitle: 'Safety Basics', dueDate: '2026-07-01', overdue: true,
};
const done: LearnerAssignment = {
  ...base, courseId: 'c-3', courseTitle: 'Ethics', dueDate: '2026-08-01', completed: true,
};
const recommended: LearnerAssignment = {
  ...base, courseId: 'c-4', courseTitle: 'Optional Extra', mandatory: false, dueDate: null,
};

function setAssignments(data: LearnerAssignment[] | undefined, isLoading = false) {
  mockUseLearnerAssignments.mockReturnValue({ data, isLoading });
}

function renderSection(view?: 'card' | 'list') {
  return render(
    <MemoryRouter>
      <MandatoryCourses orgId="org-1" view={view} />
    </MemoryRouter>,
  );
}

describe('MandatoryCourses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a card per mandatory course with a link into the player and its due date', () => {
    setAssignments([base]);
    renderSection();

    expect(screen.getByText('training.mandatory.title')).toBeInTheDocument();
    const card = screen.getByTestId('training-mandatory-card');
    expect(screen.getByText('Compliance 101')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /courses\.openCourse/ })).toHaveAttribute('href', '/app/learn/c-1?from=training');
    expect(screen.getByTestId('mandatory-due')).toHaveTextContent(formatDate(new Date('2026-09-01'), 'P', 'en'));
    expect(card.querySelector('[data-testid="mandatory-overdue"]')).toBeNull();
  });

  it('flags only overdue assignments with an overdue badge', () => {
    setAssignments([base, overdue]);
    renderSection();

    const badges = screen.getAllByTestId('mandatory-overdue');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('training.mandatory.overdue');
  });

  it('shows a completed state instead of a CTA (and no due line) for completed assignments', () => {
    setAssignments([done]);
    renderSection();

    expect(screen.getByTestId('mandatory-completed')).toHaveTextContent('training.mandatory.completed');
    expect(screen.queryByRole('link', { name: /courses\.openCourse/ })).toBeNull();
    expect(screen.queryByTestId('mandatory-due')).toBeNull();
  });

  it('excludes recommended (non-mandatory) assignments', () => {
    setAssignments([base, recommended]);
    renderSection();

    expect(screen.getByText('Compliance 101')).toBeInTheDocument();
    expect(screen.queryByText('Optional Extra')).toBeNull();
    expect(screen.getAllByTestId('training-mandatory-card')).toHaveLength(1);
  });

  it('renders the empty state (heading + empty copy) when there are no mandatory assignments', () => {
    setAssignments([recommended]); // only a recommended course -> filtered out
    renderSection();

    expect(screen.getByText('training.mandatory.title')).toBeInTheDocument();
    expect(screen.getByText('training.mandatory.empty')).toBeInTheDocument();
    expect(screen.queryByTestId('training-mandatory-card')).toBeNull();
  });

  it('renders nothing while the assignments query is still loading', () => {
    setAssignments(undefined, true);
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('training.mandatory.title')).toBeNull();
  });

  it('renders rows (not cards) in list view, keeping the player link, due date and overdue badge', () => {
    setAssignments([overdue]);
    renderSection('list');

    const row = screen.getByTestId('training-mandatory-row');
    expect(screen.queryByTestId('training-mandatory-card')).toBeNull();
    expect(screen.getByText('Safety Basics')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /courses\.openCourse/ })).toHaveAttribute('href', '/app/learn/c-2?from=training');
    expect(screen.getByTestId('mandatory-due')).toHaveTextContent(formatDate(new Date('2026-07-01'), 'P', 'en'));
    expect(row.querySelector('[data-testid="mandatory-overdue"]')).not.toBeNull();
  });

  it('shows the completed state (no CTA) in list view for completed assignments', () => {
    setAssignments([done]);
    renderSection('list');

    expect(screen.getByTestId('training-mandatory-row')).toBeInTheDocument();
    expect(screen.getByTestId('mandatory-completed')).toHaveTextContent('training.mandatory.completed');
    expect(screen.queryByRole('link', { name: /courses\.openCourse/ })).toBeNull();
  });

  it('offers a Details link to the course detail page on every card (#459)', () => {
    setAssignments([base]);
    renderSection();

    expect(screen.getByRole('link', { name: 'courses.detailsFor' })).toHaveAttribute(
      'href',
      '/app/courses/c-1',
    );
  });

  it('makes the completed marker a link into the player, not a dead badge (#459)', () => {
    setAssignments([done]);
    renderSection();

    const completed = screen.getByTestId('mandatory-completed');
    expect(completed.tagName).toBe('A');
    expect(completed).toHaveAttribute('href', '/app/learn/c-3?from=training');
    expect(screen.queryByRole('link', { name: /courses\.openCourse/ })).toBeNull();
  });

  it('keeps both affordances on a completed row in list view (#459)', () => {
    setAssignments([done]);
    renderSection('list');

    expect(screen.getByTestId('mandatory-completed')).toHaveAttribute(
      'href',
      '/app/learn/c-3?from=training',
    );
    expect(screen.getByRole('link', { name: 'courses.detailsFor' })).toHaveAttribute(
      'href',
      '/app/courses/c-3',
    );
  });
});
