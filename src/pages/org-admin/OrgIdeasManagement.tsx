import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IdeaStatusBadge } from '@/components/community/IdeaStatusBadge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { fetchIdeas, updateIdeaStatus } from '@/lib/ideas-api';
import { BUSINESS_AREAS, IDEA_STATUS_OPTIONS } from '@/lib/community-types';
import type { IdeaStatusExtended, BusinessArea, EnhancedIdea } from '@/lib/community-types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Search,
  Loader2,
  Lightbulb,
  Inbox,
  FileText,
  CheckCircle,
  XCircle,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';

interface KanbanColumn {
  key: string;
  label: string;
  icon: React.ReactNode;
  iconColor: string;
  statuses: IdeaStatusExtended[];
}

// Column icon tints mirror the prototype palette (navy / amber / green / red).
const KANBAN_COLUMNS: KanbanColumn[] = [
  { key: 'inbox', label: 'Inbox', icon: <Inbox className="h-[15px] w-[15px]" />, iconColor: 'text-primary', statuses: ['submitted', 'in_review'] },
  { key: 'backlog', label: 'Backlog', icon: <FileText className="h-[15px] w-[15px]" />, iconColor: 'text-warning', statuses: ['accepted', 'in_progress'] },
  { key: 'done', label: 'Done', icon: <CheckCircle className="h-[15px] w-[15px]" />, iconColor: 'text-success', statuses: ['done'] },
  { key: 'rejected', label: 'Rejected', icon: <XCircle className="h-[15px] w-[15px]" />, iconColor: 'text-[#c43d3d]', statuses: ['rejected'] },
];

// Map a kanban column key to the default status to assign when dropping
const COLUMN_DROP_STATUS: Record<string, IdeaStatusExtended> = {
  inbox: 'submitted',
  backlog: 'accepted',
  done: 'done',
  rejected: 'rejected',
};

export default function OrgIdeasManagement() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentOrg } = useAuth();
  const orgGuard = useOrgGuard();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBusinessArea, setSelectedBusinessArea] = useState<string>('');
  const [draggedIdeaId, setDraggedIdeaId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Status update dialog
  const [selectedIdea, setSelectedIdea] = useState<EnhancedIdea | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<IdeaStatusExtended>('submitted');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Fetch ALL non-draft ideas
  const { data: allIdeas = [], isLoading } = useQuery({
    queryKey: queryKeys.ideasAdmin.list(currentOrg?.id, searchQuery, selectedBusinessArea),
    queryFn: () => fetchIdeas(currentOrg!.id, {
      search: searchQuery || undefined,
      business_area: selectedBusinessArea ? [selectedBusinessArea as BusinessArea] : undefined,
    }),
    enabled: !!currentOrg,
  });

  const ideas = allIdeas.filter((i) => i.status !== 'draft');

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: () =>
      updateIdeaStatus(selectedIdea!.id, {
        status: newStatus,
        admin_notes: adminNotes || undefined,
        rejection_reason: newStatus === 'rejected' ? rejectionReason : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ideasAdmin.all });
      setStatusDialogOpen(false);
      setSelectedIdea(null);
      toast.success(t('ideaManagement.statusUpdated'));
    },
    onError: () => {
      toast.error(t('ideaManagement.statusUpdateFailed'));
    },
  });

  const handleDrop = async (columnKey: string) => {
    setDragOverColumn(null);
    if (!draggedIdeaId) return;
    const idea = ideas.find((i) => i.id === draggedIdeaId);
    const targetStatus = COLUMN_DROP_STATUS[columnKey];
    if (!idea || idea.status === targetStatus) {
      setDraggedIdeaId(null);
      return;
    }

    // If dropping into rejected, open dialog to collect reason
    if (columnKey === 'rejected') {
      setSelectedIdea(idea);
      setNewStatus('rejected');
      setAdminNotes(idea.admin_notes || '');
      setRejectionReason('');
      setStatusDialogOpen(true);
      setDraggedIdeaId(null);
      return;
    }

    try {
      await updateIdeaStatus(idea.id, {
        status: targetStatus,
        admin_notes: idea.admin_notes || undefined,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.ideasAdmin.all });
      // Routine inline status change: the card moving columns is the feedback (no toast).
    } catch {
      toast.error(t('ideaManagement.statusUpdateFailed'));
    } finally {
      setDraggedIdeaId(null);
    }
  };

  const breadcrumbs = [{ label: t('ideaManagement.title') }];

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
          <p className="text-muted-foreground">{t('ideaManagement.noOrgDescription')}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumbs={breadcrumbs}>
      {/* Header + business-area filter */}
      <div className="mb-5 flex flex-col items-start justify-between gap-4 md:flex-row">
        <div>
          <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t('ideaManagement.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('ideaManagement.subtitle', { orgName: currentOrg.name })}
          </p>
        </div>
        <Select
          value={selectedBusinessArea || 'all'}
          onValueChange={(v) => setSelectedBusinessArea(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="w-full shrink-0 font-semibold md:w-[200px]">
            <SelectValue placeholder={t('ideaManagement.allBusinessAreas')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('ideaManagement.allBusinessAreas')}</SelectItem>
            {BUSINESS_AREAS.map((area) => (
              <SelectItem key={area.value} value={area.value}>
                {area.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('ideaManagement.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Kanban board */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : ideas.length === 0 ? (
        <EmptyState
          icon={<Lightbulb aria-hidden="true" className="h-6 w-6" />}
          title={t('ideaManagement.emptyTitle')}
          description={t('ideaManagement.emptyDescription')}
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {KANBAN_COLUMNS.map((column) => {
            const columnIdeas = ideas.filter((idea) =>
              column.statuses.includes(idea.status)
            );
            const isDragOver = dragOverColumn === column.key;
            return (
              <div
                key={column.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverColumn !== column.key) setDragOverColumn(column.key);
                }}
                onDrop={() => handleDrop(column.key)}
                className={cn(
                  'min-h-[380px] rounded-2xl p-3 transition-colors',
                  isDragOver ? 'bg-[#e2e7f6]' : 'bg-[#eceef3]'
                )}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 px-1.5 pb-3 pt-1">
                  <span className={cn('flex', column.iconColor)}>{column.icon}</span>
                  <span className="text-[12.5px] font-extrabold tracking-[0.02em]">
                    {t(`ideaManagement.columns.${column.key}`)}
                  </span>
                  <span className="ml-auto rounded-[7px] bg-card px-[9px] py-0.5 text-[11px] font-extrabold text-muted-foreground">
                    {columnIdeas.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2.5">
                  {columnIdeas.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d6d8e0] p-4 text-center text-xs text-muted-foreground">
                      {t('ideaManagement.dropHere')}
                    </div>
                  ) : (
                    columnIdeas.map((idea) => {
                      const isDragged = draggedIdeaId === idea.id;
                      return (
                        <div
                          key={idea.id}
                          draggable
                          onDragStart={() => setDraggedIdeaId(idea.id)}
                          onDragEnd={() => {
                            setDraggedIdeaId(null);
                            setDragOverColumn(null);
                          }}
                          onClick={() => navigate(routes.community.ideaDetail(idea.id))}
                          className={cn(
                            'group cursor-grab rounded-xl border border-[#e4e6ee] bg-card px-[15px] py-[13px] transition-[transform,box-shadow,opacity]',
                            'hover:shadow-[0_8px_22px_rgba(20,24,46,0.10)]',
                            isDragged && 'rotate-2 scale-[0.98] opacity-40'
                          )}
                        >
                          <div className="mb-2 flex items-center gap-1.5">
                            <IdeaStatusBadge status={idea.status} size="sm" />
                            {idea.business_area && (
                              <span className="rounded-[7px] bg-[#f3f4f8] px-[9px] py-[3px] text-[10.5px] font-bold text-muted-foreground">
                                {BUSINESS_AREAS.find((a) => a.value === idea.business_area)?.label ??
                                  idea.business_area}
                              </span>
                            )}
                            {/* "Open ->" hint surfaces the click-to-open affordance (drag = move). */}
                            <span
                              aria-hidden="true"
                              className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] font-extrabold text-primary opacity-0 transition-opacity group-hover:opacity-100"
                            >
                              {t('ideaManagement.open')}
                              <ChevronRight className="h-3 w-3" />
                            </span>
                          </div>
                          <p className="mb-2 line-clamp-2 text-[13px] font-bold leading-[1.35]">
                            {idea.title}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <TrendingUp className="h-[11px] w-[11px]" />
                              {idea.vote_count || 0}
                            </span>
                            <span className="truncate">
                              {idea.profile?.full_name || t('ideaManagement.unknownAuthor')}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Status update dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ideaManagement.dialog.title')}</DialogTitle>
            <DialogDescription>{selectedIdea?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('ideaManagement.dialog.statusLabel')}</label>
              <Select
                value={newStatus}
                onValueChange={(v) => setNewStatus(v as IdeaStatusExtended)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IDEA_STATUS_OPTIONS.filter((s) => s.value !== 'draft').map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newStatus === 'rejected' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t('ideaManagement.dialog.rejectionReasonLabel')}
                </label>
                <Textarea
                  placeholder={t('ideaManagement.dialog.rejectionReasonPlaceholder')}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('ideaManagement.dialog.adminNotesLabel')}</label>
              <Textarea
                placeholder={t('ideaManagement.dialog.adminNotesPlaceholder')}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => statusMutation.mutate()}
              disabled={statusMutation.isPending || (newStatus === 'rejected' && !rejectionReason)}
            >
              {statusMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
