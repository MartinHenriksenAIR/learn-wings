import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, TrendingUp, Loader2, FileText } from 'lucide-react';
import { LEVEL_STYLES, type CourseLevel } from '@/components/ui/level-badge';
import type { OrgAnalyticsMember } from '@/hooks/useOrgAnalyticsData';

interface AnalyticsOverviewProps {
  stats: {
    totalUsers: number;
    activeUsers7Days: number;
    activeUsers30Days: number;
    avgQuizScore: number;
    completionRate: number;
  };
  /** Raw member rows from the analytics endpoint — used for the level distribution card. */
  members: OrgAnalyticsMember[];
  isGlobalView: boolean;
  selectedOrgId: string;
  showComplianceReport: boolean;
  generatingReport: boolean;
  onGenerateReport: () => void;
}

// Tints for the icon chips / mini-bar fills (navy primary + success green for a
// strong quiz score) — values from the design brief palette.
const NAVY = '#10298f';
const SUCCESS = '#1e9e6a';
const TRACK = '#eceef3';

// Gray used for the "not assessed" segment and legend swatch.
const NOT_ASSESSED_COLOR = '#a1a1aa'; // zinc-400, readable on white

const LEVELS: CourseLevel[] = ['basic', 'intermediate', 'advanced'];

function MiniBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <span
      aria-hidden="true"
      className="block h-[5px] flex-1 overflow-hidden rounded"
      style={{ background: TRACK }}
    >
      <span
        className="block h-full rounded"
        style={{ width: `${clamped}%`, background: NAVY, transition: 'width .4s ease' }}
      />
    </span>
  );
}

// ─── Level distribution helpers ──────────────────────────────────────────────

interface LevelCounts {
  basic: number;
  intermediate: number;
  advanced: number;
  notAssessed: number;
  total: number;
}

function computeLevelCounts(members: OrgAnalyticsMember[]): LevelCounts {
  // LOCKED: only learner-role rows count toward the distribution.
  const learners = members.filter(m => m.role === 'learner');
  const counts: LevelCounts = { basic: 0, intermediate: 0, advanced: 0, notAssessed: 0, total: learners.length };
  for (const m of learners) {
    if (m.assessment_level === 'basic') counts.basic++;
    else if (m.assessment_level === 'intermediate') counts.intermediate++;
    else if (m.assessment_level === 'advanced') counts.advanced++;
    else counts.notAssessed++;
  }
  return counts;
}

interface DistSegment {
  key: string;
  color: string;
  count: number;
  pct: number;
  label: string;
}

/**
 * Horizontal segmented bar showing AI-level distribution across learners.
 * Zero-count segments are omitted from the bar (no 0-width slivers) but
 * always shown in the legend with a count of 0.
 */
function LevelDistributionCard({
  members,
  isGlobalView,
  selectedOrgId,
}: {
  members: OrgAnalyticsMember[];
  isGlobalView: boolean;
  selectedOrgId: string;
}) {
  const { t } = useTranslation();
  const counts = useMemo(() => computeLevelCounts(members), [members]);
  const title = isGlobalView && selectedOrgId === 'all'
    ? t('assessment.analytics.distributionTitleAll')
    : t('assessment.analytics.distributionTitle');

  // Build legend items (always 4, including not-assessed).
  const legendItems: DistSegment[] = [
    ...LEVELS.map(level => ({
      key: level,
      color: LEVEL_STYLES[level].fg,
      count: counts[level],
      pct: counts.total > 0 ? (counts[level] / counts.total) * 100 : 0,
      label: t(`courses.levels.${level}`),
    })),
    {
      key: 'notAssessed',
      color: NOT_ASSESSED_COLOR,
      count: counts.notAssessed,
      pct: counts.total > 0 ? (counts.notAssessed / counts.total) * 100 : 0,
      label: t('assessment.analytics.notAssessed'),
    },
  ];

  // Bar segments: omit zero-count segments so we don't get 0-width artifacts.
  const barSegments = legendItems.filter(s => s.count > 0);

  return (
    <Card>
      <CardContent className="px-[22px] py-5">
        <h3 className="mb-0.5 text-[14px] font-extrabold">{title}</h3>
        <p className="mb-4 text-[12.5px] text-muted-foreground">
          {t('assessment.analytics.distributionSubtitle')}
        </p>

        {/* Segmented bar */}
        {counts.total === 0 ? (
          <div
            className="mb-4 h-3 w-full rounded-full"
            style={{ background: TRACK }}
            aria-label={t('assessment.analytics.noLearnerData')}
          />
        ) : (
          <div
            className="mb-4 flex h-3 w-full overflow-hidden rounded-full"
            role="img"
            aria-label={`${t('assessment.analytics.aiLevel')}: ${legendItems.map(s => `${s.label} ${s.count}`).join(', ')}`}
          >
            {barSegments.map((seg, i) => (
              <span
                key={seg.key}
                style={{
                  width: `${seg.pct}%`,
                  background: seg.color,
                  // Only round the outermost corners of the bar.
                  borderRadius: i === 0 && barSegments.length === 1
                    ? '9999px'
                    : i === 0
                      ? '9999px 0 0 9999px'
                      : i === barSegments.length - 1
                        ? '0 9999px 9999px 0'
                        : '0',
                }}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {legendItems.map(seg => (
            <span key={seg.key} className="flex items-center gap-1.5 text-[12.5px]">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: seg.color }}
                aria-hidden="true"
              />
              <span className="text-muted-foreground">{seg.label}</span>
              <span className="font-bold">{seg.count}</span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Visual-first analytics overview: a row of stat cards (icon chips, ProgressRings
 * for completion / quiz score, mini bars under the engagement metrics), plus
 * activity / learning summary cards and the AI Act compliance report card.
 * Uses only data the page already computes.
 */
export function AnalyticsOverview({
  stats,
  members,
  isGlobalView,
  selectedOrgId,
  showComplianceReport,
  generatingReport,
  onGenerateReport,
}: AnalyticsOverviewProps) {
  const { t } = useTranslation();

  const allOrgsView = isGlobalView && selectedOrgId === 'all';
  const total = Math.max(1, stats.totalUsers);
  const active7Pct = Math.round((stats.activeUsers7Days / total) * 100);
  const active30Pct = Math.round((stats.activeUsers30Days / total) * 100);
  const quizColor = stats.avgQuizScore >= 80 ? SUCCESS : NAVY;

  const cards: Array<{
    key: string;
    visual: ReactNode;
    value: ReactNode;
    label: string;
  }> = [
    {
      key: 'total',
      visual: (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent text-primary">
          <Users className="h-[17px] w-[17px]" aria-hidden="true" />
        </span>
      ),
      value: stats.totalUsers,
      label: allOrgsView ? t('analytics.totalUsers') : t('analytics.totalMembers'),
    },
    {
      key: 'active7',
      visual: (
        <span className="flex flex-1 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent text-primary">
            <TrendingUp className="h-[17px] w-[17px]" aria-hidden="true" />
          </span>
          <MiniBar pct={active7Pct} />
        </span>
      ),
      value: stats.activeUsers7Days,
      label: t('analytics.active7Days'),
    },
    {
      key: 'active30',
      visual: (
        <span className="flex flex-1 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent text-primary">
            <TrendingUp className="h-[17px] w-[17px]" aria-hidden="true" />
          </span>
          <MiniBar pct={active30Pct} />
        </span>
      ),
      value: stats.activeUsers30Days,
      label: t('analytics.active30Days'),
    },
    {
      key: 'completion',
      visual: (
        <ProgressRing
          pct={stats.completionRate}
          size={46}
          stroke={5}
          fg={NAVY}
          bg={TRACK}
          labelColor="#171a26"
        />
      ),
      value: `${stats.completionRate}%`,
      label: t('analytics.completionRate'),
    },
    {
      key: 'quiz',
      visual: (
        <ProgressRing
          pct={stats.avgQuizScore}
          size={46}
          stroke={5}
          fg={quizColor}
          bg={TRACK}
          labelColor="#171a26"
        />
      ),
      value: `${stats.avgQuizScore}%`,
      label: t('analytics.avgQuizScore'),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Visual-first stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.key}
            className="rounded-2xl border border-border bg-card px-[18px] py-4"
          >
            <div className="mb-3 flex min-h-[46px] items-center">{card.visual}</div>
            <span className="block text-[21px] font-extrabold tracking-[-0.02em]">{card.value}</span>
            <span className="mt-px block text-xs font-medium text-muted-foreground">{card.label}</span>
          </div>
        ))}
      </div>

      {/* Summary rows: activity + learning */}
      <div className="grid gap-3.5 md:grid-cols-2">
        <Card>
          <CardContent className="px-[22px] py-5">
            <h3 className="mb-3.5 text-[14px] font-extrabold">{t('analytics.activitySummary')}</h3>
            <SummaryRow label={t('analytics.engagement7Day')} value={`${active7Pct}%`} pct={active7Pct} />
            <SummaryRow label={t('analytics.engagement30Day')} value={`${active30Pct}%`} pct={active30Pct} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="px-[22px] py-5">
            <h3 className="mb-3.5 text-[14px] font-extrabold">{t('analytics.learningMetrics')}</h3>
            <SummaryRow
              label={t('analytics.courseCompletionRate')}
              value={`${stats.completionRate}%`}
              pct={stats.completionRate}
            />
            <SummaryRow
              label={t('analytics.avgQuizPerformance')}
              value={`${stats.avgQuizScore}%`}
              pct={stats.avgQuizScore}
            />
          </CardContent>
        </Card>
      </div>

      {/* AI level distribution */}
      <LevelDistributionCard
        members={members}
        isGlobalView={isGlobalView}
        selectedOrgId={selectedOrgId}
      />

      {/* AI Act compliance report */}
      {showComplianceReport && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 px-[22px] py-5">
            <div>
              <h3 className="mb-0.5 text-[14px] font-extrabold">{t('analytics.aiActCompliance')}</h3>
              <p className="text-[12.5px] text-muted-foreground">{t('analytics.aiActComplianceBlurb')}</p>
            </div>
            <Button
              onClick={onGenerateReport}
              disabled={generatingReport}
              variant="outline"
              className="shrink-0 gap-2"
            >
              {generatingReport ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              {generatingReport ? t('analytics.generatingReport') : t('analytics.downloadReport')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryRow({ label, value, pct }: { label: string; value: string; pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="border-b border-[#f3f4f8] py-2.5 last:border-b-0">
      <div className="mb-[7px] flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className="text-[13px] font-bold">{value}</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded" style={{ background: TRACK }}>
        <div
          className="h-full rounded"
          style={{ width: `${clamped}%`, background: NAVY, transition: 'width .4s ease' }}
        />
      </div>
    </div>
  );
}
