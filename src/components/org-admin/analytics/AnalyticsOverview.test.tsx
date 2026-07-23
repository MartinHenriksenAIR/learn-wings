/**
 * Tests for the level-distribution card in AnalyticsOverview.
 *
 * Covers:
 * - Learner-only scope: org_admin rows with a level must not shift the distribution.
 * - not-assessed = learners with null assessment_level.
 * - Single-org vs all-orgs title switch.
 * - Empty learner state: card renders without crashing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Stub heavy sub-components so this test stays focused on distribution logic.
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

    // t() echoes the key
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
      // This admin has a level — it must be excluded from the distribution count.
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

    // Legend shows counts. basic=2, intermediate=0, advanced=0, notAssessed=0.
    // All four legend items are rendered regardless of count.
    // We find each legend swatch label + count pair by querying the label text
    // and then reading the sibling bold count.
    const legendItems = screen.getAllByText('courses.levels.basic');
    // There's exactly one legend item for basic.
    expect(legendItems).toHaveLength(1);

    // Verify 'advanced' legend item shows 0 (admin not counted).
    const advancedLabel = screen.getByText('courses.levels.advanced');
    // The count element is the next sibling bold span. We check its text.
    expect(advancedLabel.nextSibling?.textContent).toBe('0');

    // basic count = 2
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

    // Subtitle is always shown.
    expect(screen.getByText('assessment.analytics.distributionSubtitle')).toBeInTheDocument();
    // All legend items show 0.
    const notAssessedLabel = screen.getByText('assessment.analytics.notAssessed');
    expect(notAssessedLabel.nextSibling?.textContent).toBe('0');
  });
});
