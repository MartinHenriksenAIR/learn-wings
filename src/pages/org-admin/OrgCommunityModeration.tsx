import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import { PageSpinner } from '@/components/ui/page-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { fetchReports } from '@/lib/community-api';
import { ReportedContentDialog } from '@/components/community/ReportedContentDialog';
import { ReportCard } from '@/components/community/ReportCard';
import { ReviewReportDialog } from '@/components/community/ReviewReportDialog';
import { useReportModeration, type ReportWithDetails } from '@/hooks/useReportModeration';
import type { ReportStatus } from '@/lib/community-types';
import { Loader2, Flag } from 'lucide-react';

export default function OrgCommunityModeration() {
  const { t } = useTranslation();
  const { currentOrg } = useAuth();
  const orgGuard = useOrgGuard();

  const [activeTab, setActiveTab] = useState<ReportStatus>('pending');
  const [selectedReport, setSelectedReport] = useState<ReportWithDetails | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  // Report whose content is shown in the "View content" dialog (#160).
  const [viewReport, setViewReport] = useState<ReportWithDetails | null>(null);

  // Fetch reports for org
  const { data: reports = [], isLoading } = useQuery({
    queryKey: queryKeys.orgReports.list(currentOrg?.id, activeTab),
    queryFn: async () => {
      const data = await fetchReports(currentOrg!.id, { status: activeTab });
      return data as ReportWithDetails[];
    },
    enabled: !!currentOrg,
  });

  const { updateReportMutation, toggleContentVisibility, togglePostLock } = useReportModeration(
    queryKeys.orgReports.all,
    () => {
      setReviewDialogOpen(false);
      setSelectedReport(null);
    },
  );

  const openReviewDialog = (report: ReportWithDetails) => {
    setSelectedReport(report);
    setAdminNotes(report.admin_notes || '');
    setReviewDialogOpen(true);
  };

  const handleMarkReviewed = () => {
    if (!selectedReport) return;
    updateReportMutation.mutate({
      reportId: selectedReport.id,
      status: 'reviewed',
      notes: adminNotes,
    });
  };

  const handleDismiss = () => {
    if (!selectedReport) return;
    updateReportMutation.mutate({
      reportId: selectedReport.id,
      status: 'dismissed',
      notes: adminNotes,
    });
  };

  const breadcrumbs = [{ label: t('nav.moderation') }];

  const tabs: { key: ReportStatus; label: string }[] = [
    { key: 'pending', label: t('moderation.tabs.pending') },
    { key: 'reviewed', label: t('moderation.tabs.reviewed') },
    { key: 'dismissed', label: t('moderation.tabs.dismissed') },
  ];

  // Profile-gated guard (useOrgGuard): don't flash "No Organization Selected"
  // while the signed-in user's context is still resolving.
  if (orgGuard === 'loading') {
    return (
      <AppLayout breadcrumbs={breadcrumbs}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout breadcrumbs={breadcrumbs}>
        <div className="py-12 text-center">
          <h1 className="mb-2 text-2xl font-bold">{t('common.noOrgSelected')}</h1>
          <p className="text-muted-foreground">{t('moderation.noOrgDescription')}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumbs={breadcrumbs}>
      {/* Header */}
      <div className="mb-5">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {t('moderation.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('moderation.subtitleOrg', { orgName: currentOrg.name })}
        </p>
      </div>

      {/* Tabs */}
      <SlidingTabs
        tabs={tabs}
        active={activeTab}
        onChange={(k) => setActiveTab(k as ReportStatus)}
        className="mb-5"
      />

      {/* Reports list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={<Flag aria-hidden="true" className="h-6 w-6" />}
          title={t('moderation.emptyTitle')}
          description={t('moderation.emptyDescription')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onViewContent={() => setViewReport(report)}
              onSetHidden={(hide) =>
                toggleContentVisibility.mutate({ type: report.target_type, id: report.target_id, hide })
              }
              onSetLocked={(lock) => togglePostLock.mutate({ postId: report.target_id, lock })}
              onDismiss={() => updateReportMutation.mutate({ reportId: report.id, status: 'dismissed' })}
              onReview={() => openReviewDialog(report)}
              visibilityPending={toggleContentVisibility.isPending}
              lockPending={togglePostLock.isPending}
              updatePending={updateReportMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Reported content viewer (#160) */}
      <ReportedContentDialog
        open={!!viewReport}
        onOpenChange={(o) => { if (!o) setViewReport(null); }}
        report={viewReport}
      />

      {/* Review dialog */}
      <ReviewReportDialog
        open={reviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        adminNotes={adminNotes}
        onAdminNotesChange={setAdminNotes}
        onDismiss={handleDismiss}
        onReview={handleMarkReviewed}
        pending={updateReportMutation.isPending}
      />
    </AppLayout>
  );
}
