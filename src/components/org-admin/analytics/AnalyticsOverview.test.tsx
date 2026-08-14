import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/components/ui/progress-ring', () => ({
  ProgressRing: () => null,
}));

import { AnalyticsOverview } from './AnalyticsOverview';
import type { OrgAnalyticsMember } from '@/hooks/useOrgAnalyticsData';

const BASE_STATS = {
  totalUsers: 0,
  activeUsers7Days: 0,
  activeUsers30Days: 0,
  avgQuizScore: 0,
  completionRate: 0,
};

function makeMembers(overrides: Partial<OrgAnalyticsMember>[]): OrgAnalyticsMember[] {
  return overrides.map((o, i) => ({
    user_id: `u${i}`,
    full_name: `User ${i}`,
    email: `u${i}@test.com`,
    ...o,
  }));
}

describe('AnalyticsOverview — level distribution card', () => {
  it('shows single-org title when not all-orgs', () => {
    render(
      <AnalyticsOverview
        stats={BASE_STATS}
        members={[]}
        isGlobalView={false}
        selectedOrgId="org-1"
        showComplianceReport={false}
        generatingReport={false}
        onGenerateReport={() => {}}
      />
    );

    expect(screen.getByText('assessment.analytics.distributionTitle')).toBeInTheDocument();
    expect(screen.queryByText('assessment.analytics.distributionTitleAll')).not.toBeInTheDocument();
  });

  it('shows all-orgs title when isGlobalView + selectedOrgId === "all"', () => {
    render(
      <AnalyticsOverview
        stats={BASE_STATS}
        members={[]}
        isGlobalView={true}
        selectedOrgId="all"
        showComplianceReport={false}
        generatingReport={false}
        onGenerateReport={() => {}}
      />
    );

    expect(screen.getByText('assessment.analytics.distributionTitleAll')).toBeInTheDocument();
  });

  it('counts learners only — org_admin row with a level must NOT appear in distribution', () => {
    const members = makeMembers([
      { role: 'learner', assessment_level: 'basic' },
      { role: 'learner', assessment_level: 'basic' },
      { role: 'org_admin', assessment_level: 'advanced' },
    ]);

    render(
      <AnalyticsOverview
        stats={BASE_STATS}
        members={members}
        isGlobalView={false}
        selectedOrgId="org-1"
        showComplianceReport={false}
        generatingReport={false}
        onGenerateReport={() => {}}
      />
    );

    const legendItems = screen.getAllByText('courses.levels.basic');
    expect(legendItems).toHaveLength(1);

    const advancedLabel = screen.getByText('courses.levels.advanced');
    expect(advancedLabel.nextSibling?.textContent).toBe('0');

    const basicLabel = screen.getByText('courses.levels.basic');
    expect(basicLabel.nextSibling?.textContent).toBe('2');
  });

  it('counts null assessment_level learners as not-assessed', () => {
    const members = makeMembers([
      { role: 'learner', assessment_level: 'intermediate' },
      { role: 'learner', assessment_level: null },
      { role: 'learner', assessment_level: null },
    ]);

    render(
      <AnalyticsOverview
        stats={BASE_STATS}
        members={members}
        isGlobalView={false}
        selectedOrgId="org-1"
        showComplianceReport={false}
        generatingReport={false}
        onGenerateReport={() => {}}
      />
    );

    const notAssessedLabel = screen.getByText('assessment.analytics.notAssessed');
    expect(notAssessedLabel.nextSibling?.textContent).toBe('2');

    const intermediateLabel = screen.getByText('courses.levels.intermediate');
    expect(intermediateLabel.nextSibling?.textContent).toBe('1');
  });

  it('renders without crashing when there are no learner rows', () => {
    render(
      <AnalyticsOverview
        stats={BASE_STATS}
        members={[]}
        isGlobalView={false}
        selectedOrgId="org-1"
        showComplianceReport={false}
        generatingReport={false}
        onGenerateReport={() => {}}
      />
    );

    expect(screen.getByText('assessment.analytics.distributionSubtitle')).toBeInTheDocument();
    const notAssessedLabel = screen.getByText('assessment.analytics.notAssessed');
    expect(notAssessedLabel.nextSibling?.textContent).toBe('0');
  });
});
