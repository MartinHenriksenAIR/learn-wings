import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchReports } from '@/lib/community-api';
import { ReportedContentDialog } from '@/components/community/ReportedContentDialog';
import { ReportCard } from '@/components/community/ReportCard';
import { ReviewReportDialog } from '@/components/community/ReviewReportDialog';
import { useReportModeration, type ReportWithDetails } from '@/hooks/useReportModeration';
import { useOrganizations } from '@/hooks/useOrganizations';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { ReportStatus } from '@/lib/community-types';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Flag,
  Check,
  ChevronsUpDown,
} from 'lucide-react';

export default function PlatformCommunityModeration() {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<ReportStatus>('pending');
  const [selectedReport, setSelectedReport] = useState<ReportWithDetails | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  // Report whose content is shown in the "View content" dialog (#160).
  const [viewReport, setViewReport] = useState<ReportWithDetails | null>(null);
  // Scope filter: 'all' | 'global' | <orgId> (#164).
  const [scope, setScope] = useState<string>('all');
  const [scopeOpen, setScopeOpen] = useState(false);

  // Fetch reports for the selected scope: all orgs + global, global only, or one org.
  const { data: reports = [], isLoading } = useQuery({
    queryKey: queryKeys.platformReports.list(scope, activeTab),
    queryFn: async () => {
      const data =
        scope === 'all'
          ? await fetchReports(undefined, { status: activeTab })
          : scope === 'global'
            ? await fetchReports(undefined, { scope: 'global', status: activeTab })
            : await fetchReports(scope, { status: activeTab });
      return data as ReportWithDetails[];
    },
  });

  // Fetch all organizations for name lookup (shared ['organizations'] cache, #87).
  // org names don't change mid-session; the longer staleTime avoids window-focus refetches.
  const { data: orgsData } = useOrganizations({ staleTime: 5 * 60 * 1000 });
  const orgsMap = useMemo(() => {
    if (!orgsData) return undefined;
    const map = new Map<string, string>();
    for (const org of orgsData) {
      map.set(org.id, org.name);
    }
    return map;
  }, [orgsData]);

  const { updateReportMutation, toggleContentVisibility, togglePostLock } = useReportModeration(
    queryKeys.platformReports.all,
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

  // Org-scope badge: platform queue spans every org plus global, so each card
  // shows where the report came from (Global, or the org name).
  const getScopeLabel = (report: ReportWithDetails): { label: string; global: boolean } => {
    if (!report.org_id) {
      return { label: t('platformModeration.scopeGlobal'), global: true };
    }
    const orgName = orgsMap?.get(report.org_id) ?? t('platformModeration.scopeOrganization');
    return { label: orgName, global: false };
  };

  const breadcrumbs = [{ label: t('platformModeration.title') }];

  const tabs: { key: ReportStatus; label: string }[] = [
    { key: 'pending', label: t('moderation.tabs.pending') },
    { key: 'reviewed', label: t('moderation.tabs.reviewed') },
    { key: 'dismissed', label: t('moderation.tabs.dismissed') },
  ];

  const scopeLabel =
    scope === 'all'
      ? t('platformModeration.scopeAll')
      : scope === 'global'
        ? t('platformModeration.scopeGlobal')
        : orgsMap?.get(scope) ?? t('platformModeration.scopeOrganization');

  return (
    <AppLayout breadcrumbs={breadcrumbs}>
      {/* Header */}
      <div className="mb-5">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {t('platformModeration.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('platformModeration.description')}</p>
      </div>

      {/* Scope filter (#164) */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          {t('platformModeration.scopeSelectLabel')}
        </span>
        <Popover open={scopeOpen} onOpenChange={setScopeOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              role="combobox"
              aria-expanded={scopeOpen}
              className="w-[240px] justify-between"
            >
              {scopeLabel}
              <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[240px] p-0" align="start">
            <Command>
              <CommandInput placeholder={t('platformModeration.scopeSearchPlaceholder')} />
              <CommandList>
                <CommandEmpty>{t('platformModeration.scopeNoResults')}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value={t('platformModeration.scopeAll')}
                    onSelect={() => { setScope('all'); setScopeOpen(false); }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', scope === 'all' ? 'opacity-100' : 'opacity-0')} />
                    {t('platformModeration.scopeAll')}
                  </CommandItem>
                  <CommandItem
                    value={t('platformModeration.scopeGlobal')}
                    onSelect={() => { setScope('global'); setScopeOpen(false); }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', scope === 'global' ? 'opacity-100' : 'opacity-0')} />
                    {t('platformModeration.scopeGlobal')}
                  </CommandItem>
                  {(orgsData ?? []).map((org) => (
                    <CommandItem
                      key={org.id}
                      value={org.name}
                      onSelect={() => { setScope(org.id); setScopeOpen(false); }}
                    >
                      <Check className={cn('mr-2 h-4 w-4', scope === org.id ? 'opacity-100' : 'opacity-0')} />
                      {org.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
            const scopeBadge = getScopeLabel(report);
            return (
              <ReportCard
                key={report.id}
                report={report}
                scopeBadge={
                  /* Org column: platform queue spans orgs + global */
                  <span
                    className={cn(
                      'rounded-[7px] px-[11px] py-1 text-[11px] font-bold',
                      scopeBadge.global
                        ? 'bg-[#f3f4f8] text-muted-foreground'
                        : 'bg-accent text-accent-foreground'
                    )}
                  >
                    {scopeBadge.label}
                  </span>
                }
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
