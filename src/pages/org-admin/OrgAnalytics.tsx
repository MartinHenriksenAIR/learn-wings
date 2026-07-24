import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSpinner } from '@/components/ui/page-spinner';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FileUpload } from '@/components/ui/file-upload';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useOrgAnalyticsData } from '@/hooks/useOrgAnalyticsData';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { callApi, callApiRaw } from '@/lib/api-client';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';
import { routes } from '@/lib/routes';
import { Users, BarChart3, BookOpen, Building2, Pencil, GraduationCap } from 'lucide-react';
import { toast } from 'sonner';
import { AnalyticsOverview } from '@/components/org-admin/analytics/AnalyticsOverview';
import { TeamPerformanceTab, type UserStats } from '@/components/org-admin/analytics/TeamPerformanceTab';
import { CourseProgressTab } from '@/components/org-admin/analytics/CourseProgressTab';
import { OrgMembersTab } from '@/components/org-admin/OrgMembersTab';

const ZERO_STATS = {
  totalUsers: 0,
  activeUsers7Days: 0,
  activeUsers30Days: 0,
  avgQuizScore: 0,
  completionRate: 0,
};

export default function OrgAnalytics() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isGlobalView = location.pathname === routes.platformAdmin.analytics;
  const { currentOrg, isPlatformAdmin, refreshUserContext } = useAuth();
  const { data: orgLogoSrc } = useSignedBrandingUrl(currentOrg?.logo_url);
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Sync tab with URL
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams({ tab: value });
  };

  // Fetch organizations for global view filter (shared cache, #87)
  const { data: orgsData, error: orgsError } = useOrganizations({
    enabled: isGlobalView && isPlatformAdmin,
  });
  // endpoint returns created_at DESC (accepted 3a parity break); the filter dropdown was name-ordered
  const organizations = useMemo(
    () => [...(orgsData ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [orgsData]
  );
  useEffect(() => {
    // parity: the old client ignored fetch errors (filter just shows "All Organizations")
    if (orgsError) {
      console.error('OrgAnalytics: failed to load organizations', orgsError);
    }
  }, [orgsError]);

  // Determine which org ID to use for queries. In global view selectedOrgId is either the
  // 'all' sentinel or a concrete org id — both truthy, so the analytics queries stay enabled
  // and every tab renders. 'all' flows through to the backend, which returns the platform-admin
  // cross-org aggregate (#159); previously this collapsed to null and showed an empty view.
  const effectiveOrgId = isGlobalView ? selectedOrgId : currentOrg?.id;

  // Fetch org analytics data via shared query hook. Enabled for both a concrete org and the
  // 'all' aggregate; only disabled in org view before currentOrg resolves.
  const analyticsQuery = useOrgAnalyticsData(effectiveOrgId ?? undefined);

  // Derive stats from query data — byte-for-byte reduction from the old fetchData
  const stats = useMemo(() => {
    const data = analyticsQuery.data;
    if (!data) return ZERO_STATS;

    const totalUsers = data.members.length;
    const totalEnrollments = data.enrollments.length;
    const completedEnrollments = data.enrollments.filter(e => e.status === 'completed').length;
    const completionRate = totalEnrollments > 0
      ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0;
    const avgQuizScore = data.quizAttempts.length > 0
      ? Math.round(data.quizAttempts.reduce((acc, a) => acc + a.score, 0) / data.quizAttempts.length) : 0;

    return { totalUsers, activeUsers7Days: 0, activeUsers30Days: 0, avgQuizScore, completionRate };
  }, [analyticsQuery.data]);

  const departments = useMemo(() => {
    const data = analyticsQuery.data;
    if (!data) return [];
    const depts = data.members.map(m => m.department).filter((d): d is string => Boolean(d));
    return [...new Set(depts)];
  }, [analyticsQuery.data]);

  const userStats = useMemo((): UserStats[] => {
    const data = analyticsQuery.data;
    if (!data) return [];

    const enrollmentMap = new Map<string, { total: number; completed: number }>();
    data.enrollments.forEach(e => {
      const existing = enrollmentMap.get(e.user_id) || { total: 0, completed: 0 };
      existing.total += 1;
      if (e.status === 'completed') existing.completed += 1;
      enrollmentMap.set(e.user_id, existing);
    });

    const attemptMap = new Map<string, { totalScore: number; attempts: number }>();
    data.quizAttempts.forEach(a => {
      const existing = attemptMap.get(a.user_id) || { totalScore: 0, attempts: 0 };
      existing.totalScore += a.score;
      existing.attempts += 1;
      attemptMap.set(a.user_id, existing);
    });

    return data.members.map(m => {
      const enrollStats = enrollmentMap.get(m.user_id) || { total: 0, completed: 0 };
      const attemptStats = attemptMap.get(m.user_id) || { totalScore: 0, attempts: 0 };
      return {
        id: m.user_id,
        name: m.full_name,
        department: m.department || null,
        enrollments: enrollStats.total,
        completed: enrollStats.completed,
        avgQuizScore: attemptStats.attempts > 0
          ? Math.round(attemptStats.totalScore / attemptStats.attempts) : 0,
        assessment_level: m.assessment_level ?? null,
      };
    });
  }, [analyticsQuery.data]);

  // Generate compliance report
  const handleGenerateReport = async () => {
    // The compliance report is per-org — not offered for the 'all' aggregate.
    if (!effectiveOrgId || effectiveOrgId === 'all') {
      toast.error('Please select an organization');
      return;
    }

    setGeneratingReport(true);
    try {
      // #71: report follows the reader's live UI language (ADR-0016 category 3)
      const response = await callApiRaw('/api/generate-compliance-report', { orgId: effectiveOrgId, language: i18n.resolvedLanguage });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-act-compliance-report-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Compliance report downloaded successfully');
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate report');
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleLogoUpload = async (_url: string | null, storagePath: string | null) => {
    if (!currentOrg || !storagePath) return;

    setUploading(true);
    try {
      // storagePath is the container-relative Azure blob path; store it raw and
      // sign it for display at view time (useSignedBrandingUrl).
      await callApi('/api/organization-update', {
        orgId: currentOrg.id,
        updates: { logo_url: storagePath },
      });

      toast.success('Logo updated successfully');
      setLogoDialogOpen(false);
      await refreshUserContext();
    } catch (error: any) {
      console.error('Error updating logo:', error);
      toast.error(error.message || 'Failed to update logo');
    } finally {
      setUploading(false);
    }
  };

  // Redirect if analytics are disabled
  if (!settingsLoading && !features.analytics_enabled) {
    return <Navigate to={routes.learner.dashboard} replace />;
  }

  const pageTitle = isGlobalView ? t('nav.globalAnalytics') : t('nav.organization');
  const breadcrumbs = isGlobalView
    ? [{ label: t('nav.platformAdmin') }, { label: t('nav.globalAnalytics') }]
    : [{ label: t('nav.organization') }];

  if (analyticsQuery.isLoading || settingsLoading) {
    return (
      <AppLayout title={pageTitle} breadcrumbs={breadcrumbs}>
        <PageSpinner />
      </AppLayout>
    );
  }

  // For org-specific view, require currentOrg
  if (!isGlobalView && !currentOrg) {
    return (
      <AppLayout title={pageTitle} breadcrumbs={breadcrumbs}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No organization selected.</p>
          <p className="text-sm text-muted-foreground">Join an organization to view analytics.</p>
        </div>
      </AppLayout>
    );
  }

  // A failed analytics fetch must not render all-zero stats — an org admin would
  // read the zeros as truth. Show a distinct, retryable error fork instead.
  if (analyticsQuery.isError) {
    return (
      <AppLayout title={pageTitle} breadcrumbs={breadcrumbs}>
        <div className="flex h-64 items-center justify-center">
          <QueryErrorState onRetry={() => analyticsQuery.refetch()} />
        </div>
      </AppLayout>
    );
  }

  const subtitle = isGlobalView
    ? selectedOrgId === 'all'
      ? t('analytics.subtitleGlobalAll')
      : t('analytics.subtitleGlobalOne')
    : t('analytics.subtitleOrg', { orgName: currentOrg?.name ?? t('nav.organization') });

  // SlidingTabs definitions — the Members tab is org-only (no all-orgs membership
  // view yet), matching the previous Tabs render exactly.
  const tabs = [
    { key: 'overview', label: t('analytics.tabs.overview'), icon: <BarChart3 className="h-4 w-4" aria-hidden="true" /> },
    ...(!isGlobalView
      ? [{ key: 'members', label: t('analytics.tabs.members'), icon: <Users className="h-4 w-4 shrink-0" aria-hidden="true" /> }]
      : []),
    { key: 'team', label: t('analytics.tabs.team'), icon: <GraduationCap className="h-4 w-4" aria-hidden="true" /> },
    { key: 'courses', label: t('analytics.tabs.courses'), icon: <BookOpen className="h-4 w-4" aria-hidden="true" /> },
  ];

  return (
    <AppLayout breadcrumbs={breadcrumbs}>
      {/* Header: title + subtitle, with the global org filter aligned right */}
      <div className="mb-5 flex flex-col items-start justify-between gap-4 md:flex-row">
        <div>
          <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">{pageTitle}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {isGlobalView && isPlatformAdmin && (
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-[220px] shrink-0">
              <SelectValue placeholder={t('analytics.allOrganizations')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('analytics.allOrganizations')}</SelectItem>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!isGlobalView && currentOrg && (
        <Card className="mb-6">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="relative group shrink-0">
              {orgLogoSrc ? (
                <img
                  src={orgLogoSrc}
                  alt={`${currentOrg.name} logo`}
                  className="h-16 w-16 rounded-xl object-contain bg-muted"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
                  <Building2 className="h-8 w-8 text-primary" />
                </div>
              )}
              <Dialog open={logoDialogOpen} onOpenChange={setLogoDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute -bottom-2 -right-2 h-7 w-7 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </DialogTrigger>
                {/* No description text by design — explicit opt-out silences Radix's missing-Description a11y warning */}
                <DialogContent aria-describedby={undefined}>
                  <DialogHeader>
                    <DialogTitle>Update Organization Logo</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="border-2 border-dashed rounded-lg p-6 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted">
                          <Building2 className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Recommended specifications</p>
                          <p className="text-xs text-muted-foreground">Square image, 256×256px or larger</p>
                          <p className="text-xs text-muted-foreground">PNG or JPG format, max 2MB</p>
                        </div>
                      </div>
                    </div>
                    <FileUpload
                      assetType="org-logo"
                      folder={currentOrg.id}
                      accept="image"
                      maxSizeMB={2}
                      onChange={handleLogoUpload}
                      disabled={uploading}
                    />
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div>
              <h2 className="font-display text-xl font-bold">{currentOrg.name}</h2>
              <p className="text-sm text-muted-foreground">Organization ID: {currentOrg.slug}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <SlidingTabs tabs={tabs} active={activeTab} onChange={handleTabChange} className="mb-6" />

      {activeTab === 'overview' && (
        <AnalyticsOverview
          stats={stats}
          members={analyticsQuery.data?.members ?? []}
          isGlobalView={isGlobalView}
          selectedOrgId={selectedOrgId}
          showComplianceReport={!isGlobalView && !!currentOrg}
          generatingReport={generatingReport}
          onGenerateReport={handleGenerateReport}
        />
      )}

      {!isGlobalView && activeTab === 'members' && <OrgMembersTab />}

      {activeTab === 'team' &&
        (effectiveOrgId ? (
          <TeamPerformanceTab userStats={userStats} departments={departments} orgId={effectiveOrgId} />
        ) : (
          <div className="py-12 text-center text-muted-foreground">
            Select an organization to view team performance.
          </div>
        ))}

      {activeTab === 'courses' &&
        (effectiveOrgId ? (
          <CourseProgressTab orgId={effectiveOrgId} />
        ) : (
          <div className="py-12 text-center text-muted-foreground">
            Select an organization to view course progress.
          </div>
        ))}
    </AppLayout>
  );
}
