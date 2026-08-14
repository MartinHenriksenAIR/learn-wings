import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/components/org-admin/UserProgressDialog', () => ({
  UserProgressDialog: () => null,
}));

vi.mock('@/components/ui/level-badge', () => ({
  LevelBadge: ({ level }: { level: string }) =>
    React.createElement('span', { 'data-testid': 'level-badge' }, `courses.levels.${level}`),
  LEVEL_STYLES: {
    basic: { fg: '#1e9e6a', bg: '#e7f6ef' },
    intermediate: { fg: '#b07514', bg: '#fbf2dd' },
    advanced: { fg: '#c43d3d', bg: '#fdecec' },
  },
}));

import { TeamPerformanceTab, type UserStats } from './TeamPerformanceTab';

function makeUser(overrides: Partial<UserStats> & { id: string }): UserStats {
  return {
    id: overrides.id,
    name: overrides.name ?? `User ${overrides.id}`,
    department: overrides.department ?? null,
    enrollments: overrides.enrollments ?? 0,
    completed: overrides.completed ?? 0,
    avgQuizScore: overrides.avgQuizScore ?? 0,
    assessment_level: overrides.assessment_level,
  };
}

function renderTab(users: UserStats[]) {
  return render(
    <TeamPerformanceTab
      userStats={users}
      departments={[]}
      orgId="org-1"
    />
  );
}

describe('TeamPerformanceTab — AI-niveau column', () => {
  it('renders the AI level column header via i18n key', () => {
    renderTab([makeUser({ id: 'u1' })]);

    expect(screen.getAllByText('assessment.analytics.aiLevel').length).toBeGreaterThanOrEqual(1);
  });

  it('renders LevelBadge for a member with assessment_level set', () => {
    renderTab([makeUser({ id: 'u1', assessment_level: 'intermediate' })]);

    const badge = screen.getByTestId('level-badge');
    expect(badge).toHaveTextContent('courses.levels.intermediate');
  });

  it('renders an em-dash for a member with null assessment_level', () => {
    renderTab([makeUser({ id: 'u1', assessment_level: null })]);

    expect(screen.queryByTestId('level-badge')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders an em-dash for a member with undefined assessment_level', () => {
    renderTab([makeUser({ id: 'u1' })]);

    expect(screen.queryByTestId('level-badge')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders multiple rows — leveled and null side by side', () => {
    const users = [
      makeUser({ id: 'u1', name: 'Alice', assessment_level: 'advanced' }),
      makeUser({ id: 'u2', name: 'Bob', assessment_level: null }),
    ];
    renderTab(users);

    expect(screen.getByTestId('level-badge')).toHaveTextContent('courses.levels.advanced');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('assessment_level flows through — all-orgs shaped data is just another UserStats array', () => {
    const users = [
      makeUser({ id: 'u1', name: 'Carol', assessment_level: 'basic' }),
      makeUser({ id: 'u2', name: 'Dave', assessment_level: null }),
    ];

    render(
      <TeamPerformanceTab
        userStats={users}
        departments={[]}
        orgId="all"
      />
    );

    expect(screen.getByTestId('level-badge')).toHaveTextContent('courses.levels.basic');
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
