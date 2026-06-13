import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PageSpinner } from '@/components/ui/page-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { fetchReports, updateReport, togglePostHidden, toggleCommentHidden, togglePostLocked } from '@/lib/community-api';
import { buildReportContentLink } from '@/lib/community-report-link';
import type { CommunityReport, ReportStatus } from '@/lib/community-types';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Loader2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
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

  // Fetch reports for org
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['org-reports', currentOrg?.id, activeTab],
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
      queryClient.invalidateQueries({ queryKey: ['org-reports'] });
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
      queryClient.invalidateQueries({ queryKey: ['org-reports'] });
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
      queryClient.invalidateQueries({ queryKey: ['org-reports'] });
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

  // null for orphaned comment reports (parent post id missing) — the View
  // content button is disabled rather than opening a broken link (#86).
  const getContentLink = (report: ReportWithDetails) => buildReportContentLink(report, 'org');

  const openContentInNewTab = (report: ReportWithDetails) => {
    const path = getContentLink(report);
    if (!path) return;
    window.open(path, '_blank', 'noopener,noreferrer');
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

                  {/* Action controls — kept exactly as today (view/hide/show/lock/unlock/review/dismiss) */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openContentInNewTab(report)}
                          disabled={!getContentLink(report)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {t('moderation.viewContent')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('moderation.viewContent')}</TooltipContent>
                    </Tooltip>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleContentVisibility.mutate({
                        type: report.target_type,
                        id: report.target_id,
                        hide: true,
                      })}
                      disabled={toggleContentVisibility.isPending}
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      {isPost ? t('moderation.hidePost') : t('moderation.hideComment')}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleContentVisibility.mutate({
                        type: report.target_type,
                        id: report.target_id,
                        hide: false,
                      })}
                      disabled={toggleContentVisibility.isPending}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {isPost ? t('moderation.showPost') : t('moderation.showComment')}
                    </Button>

                    {isPost && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => togglePostLock.mutate({
                            postId: report.target_id,
                            lock: true,
                          })}
                          disabled={togglePostLock.isPending}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          {t('moderation.lockPost')}
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => togglePostLock.mutate({
                            postId: report.target_id,
                            lock: false,
                          })}
                          disabled={togglePostLock.isPending}
                        >
                          <Unlock className="h-3.5 w-3.5" />
                          {t('moderation.unlockPost')}
                        </Button>
                      </>
                    )}

                    {report.status === 'pending' && (
                      <>
                        <div className="flex-1" />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => updateReportMutation.mutate({
                            reportId: report.id,
                            status: 'dismissed',
                          })}
                          disabled={updateReportMutation.isPending}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t('moderation.dismiss')}
                        </Button>

                        <Button
                          size="sm"
                          onClick={() => openReviewDialog(report)}
                          disabled={updateReportMutation.isPending}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          {t('moderation.markReviewed')}
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
