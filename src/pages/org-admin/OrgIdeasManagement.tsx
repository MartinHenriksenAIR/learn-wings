import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { useAuth } from '@/hooks/useAuth';
import { fetchIdeas, updateIdeaStatus } from '@/lib/ideas-api';
import { BUSINESS_AREAS, IDEA_STATUS_OPTIONS } from '@/lib/community-types';
import type { IdeaStatusExtended, BusinessArea, EnhancedIdea } from '@/lib/community-types';
import { toast } from 'sonner';
import {
  Search,
  Loader2,
  Lightbulb,
  Inbox,
  FileText,
  CheckCircle,
  XCircle,
} from 'lucide-react';

interface KanbanColumn {
  key: string;
  label: string;
  icon: React.ReactNode;
  statuses: IdeaStatusExtended[];
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  { key: 'inbox', label: 'Inbox', icon: <Inbox className="h-4 w-4" />, statuses: ['submitted', 'in_review'] },
  { key: 'backlog', label: 'Backlog', icon: <FileText className="h-4 w-4" />, statuses: ['accepted', 'in_progress'] },
  { key: 'done', label: 'Done', icon: <CheckCircle className="h-4 w-4" />, statuses: ['done'] },
  { key: 'rejected', label: 'Rejected', icon: <XCircle className="h-4 w-4" />, statuses: ['rejected'] },
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
  const { currentOrg } = useAuth();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBusinessArea, setSelectedBusinessArea] = useState<string>('');
  const [draggedIdeaId, setDraggedIdeaId] = useState<string | null>(null);

  // Status update dialog
  const [selectedIdea, setSelectedIdea] = useState<EnhancedIdea | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<IdeaStatusExtended>('submitted');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Fetch ALL non-draft ideas
  const { data: allIdeas = [], isLoading } = useQuery({
    queryKey: ['ideas-admin', currentOrg?.id, searchQuery, selectedBusinessArea],
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
      queryClient.invalidateQueries({ queryKey: ['ideas-admin'] });
      setStatusDialogOpen(false);
      setSelectedIdea(null);
      toast.success('Status updated');
    },
    onError: () => {
      toast.error('Failed to update status');
    },
  });

  const handleDrop = async (columnKey: string) => {
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
      queryClient.invalidateQueries({ queryKey: ['ideas-admin'] });
      toast.success('Status updated');
    } catch {
      toast.error('Failed to update status');
    } finally {
      setDraggedIdeaId(null);
    }
  };

  if (!currentOrg) {
    return (
      <AppLayout>
        <div className="container mx-auto py-12 text-center">
          <h1 className="text-2xl font-bold mb-2">No Organization Selected</h1>
          <p className="text-muted-foreground">Please select an organization to manage ideas.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto py-6 px-4">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Idea Management</h1>
          <p className="text-muted-foreground">
            Review and manage submitted ideas from {currentOrg.name}
          </p>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search ideas..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select
                value={selectedBusinessArea || 'all'}
                onValueChange={(v) => setSelectedBusinessArea(v === 'all' ? '' : v)}
              >
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="All business areas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All business areas</SelectItem>
                  {BUSINESS_AREAS.map((area) => (
                    <SelectItem key={area.value} value={area.value}>
                      {area.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Kanban board */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : ideas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No ideas found</h3>
              <p className="text-muted-foreground">No submitted ideas yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
            {KANBAN_COLUMNS.map((column) => {
              const columnIdeas = ideas.filter((idea) =>
                column.statuses.includes(idea.status)
              );
              return (
                <Card
                  key={column.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(column.key)}
                  className="min-h-[300px]"
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="flex items-center gap-2">
                        {column.icon}
                        {column.label}
                      </span>
                      <Badge variant="secondary">{columnIdeas.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {columnIdeas.length === 0 ? (
                      <div className="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
                        Drop ideas here
                      </div>
                    ) : (
                      columnIdeas.map((idea) => (
                        <div
                          key={idea.id}
                          draggable
                          onDragStart={() => setDraggedIdeaId(idea.id)}
                          onDragEnd={() => setDraggedIdeaId(null)}
                          onClick={() => navigate(`/app/community/org/ideas/${idea.id}`)}
                          className="cursor-move rounded border p-3 hover:bg-muted/50 transition-colors"
                        >
                          <p className="line-clamp-2 font-medium text-sm">{idea.title}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <IdeaStatusBadge status={idea.status} size="sm" />
                            <span className="text-xs text-muted-foreground">{idea.vote_count || 0} 👍</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground truncate">
                            {idea.profile?.full_name || 'Unknown'}
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Status update dialog */}
        <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update Idea Status</DialogTitle>
              <DialogDescription>{selectedIdea?.title}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
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
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {newStatus === 'rejected' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Rejection Reason *</label>
                  <Textarea
                    placeholder="Explain why this idea was rejected..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Admin Notes (internal)</label>
                <Textarea
                  placeholder="Notes visible only to admins..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => statusMutation.mutate()}
                disabled={statusMutation.isPending || (newStatus === 'rejected' && !rejectionReason)}
              >
                {statusMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
