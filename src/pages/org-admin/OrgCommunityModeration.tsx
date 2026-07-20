import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageSpinner } from '@/components/ui/page-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { fetchReports, updateReport, togglePostHidden, toggleCommentHidden, togglePostLocked } from '@/lib/community-api';
import { ReportedContentDialog } from '@/components/community/ReportedContentDialog';
import { ReportActions } from '@/components/community/ReportActions';
import type { CommunityReport, ReportStatus } from '@/lib/community-types';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Flag,
  MessageSquare,
  FileText,
} from 'lucide-react';

interface ReportWithDetails extends Omit<CommunityReport, 'reporter'> {
  reporter?: { id: string; full_name: string };
}

export default function OrgCommunityModeration() {
  const { t } = useTranslation();
  const { currentOrg } = useAuth();
  const orgGuard = useOrgGuard();
  const queryClient = useQueryClient();

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

  // Update report status — moderation decisions keep their toasts (toast policy).
  const updateReportMutation = useMutation({
    mutationFn: async ({
      reportId,
      status,
      notes,
    }: {
      reportId: string;
      status: 'reviewed' | 'dismissed';
      notes?: string;
    }) => {
      await updateReport(reportId, { status, admin_notes: notes || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orgReports.all });
      setReviewDialogOpen(false);
      setSelectedReport(null);
      toast.success(t('moderation.reportUpdated'));
    },
    onError: () => {
      toast.error(t('moderation.reportUpdateFailed'));
    },
  });

  // Hide/show content — moderation decisions keep their toasts (toast policy).
  const toggleContentVisibility = useMutation({
    mutationFn: async ({
      type,
      id,
      hide,
    }: {
      type: 'post' | 'comment';
      id: string;
      hide: boolean;
    }) => {
      if (type === 'post') {
        await togglePostHidden(id, hide);
      } else {
        await toggleCommentHidden(id, hide);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orgReports.all });
      toast.success(t('moderation.visibilityUpdated'));
    },
    onError: () => {
      toast.error(t('moderation.contentUpdateFailed'));
    },
  });

  // Lock/unlock post comments — moderation decisions keep their toasts (toast policy).
  const togglePostLock = useMutation({
    mutationFn: async ({ postId, lock }: { postId: string; lock: boolean }) => {
      await togglePostLocked(postId, lock);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orgReports.all });
      toast.success(t('moderation.lockUpdated'));
    },
    onError: () => {
      toast.error(t('moderation.postUpdateFailed'));
    },
  });

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
          {reports.map((report) => {
            const isPost = report.target_type === 'post';
            return (
              <Card key={report.id}>
                <CardContent className="px-[22px] py-[18px]">
                  {/* Meta row */}
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#fdecec] text-[#c43d3d]">
                      {isPost ? <FileText className="h-[15px] w-[15px]" /> : <MessageSquare className="h-[15px] w-[15px]" />}
                    </span>
                    <span className="rounded-[7px] bg-[#f3f4f8] px-[11px] py-1 text-[11px] font-bold text-muted-foreground">
                      {isPost ? t('moderation.typePost') : t('moderation.typeComment')}
                    </span>
                    <span
                      className={cn(
                        'rounded-[7px] px-[11px] py-1 text-[11px] font-bold capitalize',
                        report.status === 'pending'
                          ? 'bg-[#fdecec] text-[#c43d3d]'
                          : 'bg-[#f3f4f8] text-muted-foreground'
                      )}
                    >
                      {report.status}
                    </span>
                    <div className="flex-1" />
                    <span className="text-[11.5px] font-semibold text-muted-foreground">
                      {t('moderation.reportedBy', {
                        name: report.reporter?.full_name || t('moderation.unknownReporter'),
                        time: formatDistanceToNow(new Date(report.created_at), { addSuffix: true }),
                      })}
                    </span>
                  </div>

                  {/* Reason */}
                  <p className="mb-1 text-[13.5px] font-bold">{t('moderation.reasonLabel')}</p>
                  <p className="mb-3.5 text-[13px] italic leading-[1.5] text-muted-foreground">
                    {report.reason}
                  </p>

                  {report.admin_notes && (
                    <p className="mb-3.5 rounded-[10px] bg-[#fbf2dd] px-3.5 py-2.5 text-[12.5px] text-[#8a5e10]">
                      <strong>{t('moderation.adminNotesInline')}</strong> {report.admin_notes}
                    </p>
                  )}

                  <ReportActions
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reported content viewer (#160) */}
      <ReportedContentDialog
        open={!!viewReport}
        onOpenChange={(o) => { if (!o) setViewReport(null); }}
        report={viewReport}
      />

      {/* Review dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('moderation.dialog.title')}</DialogTitle>
            <DialogDescription>{t('moderation.dialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('moderation.dialog.adminNotesLabel')}</label>
              <Textarea
                placeholder={t('moderation.dialog.adminNotesPlaceholder')}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={handleDismiss}
              disabled={updateReportMutation.isPending}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {t('moderation.dismiss')}
            </Button>
            <Button onClick={handleMarkReviewed} disabled={updateReportMutation.isPending}>
              {updateReportMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              {t('moderation.markReviewed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
