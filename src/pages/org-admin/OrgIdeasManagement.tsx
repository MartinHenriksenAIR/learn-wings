import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IdeaStatusBadge } from '@/components/community/IdeaStatusBadge';
import { useAuth } from '@/hooks/useAuth';
import { fetchIdeas, updateIdeaStatus } from '@/lib/ideas-api';
import { BUSINESS_AREAS, IDEA_STATUS_OPTIONS } from '@/lib/community-types';
import type { IdeaStatusExtended, BusinessArea, EnhancedIdea } from '@/lib/community-types';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Search,
  Loader2,
  MoreHorizontal,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  ThumbsUp,
  Lightbulb,
} from 'lucide-react';

export default function OrgIdeasManagement() {
  const navigate = useNavigate();
  const { currentOrg } = useAuth();
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

  // Fetch ALL ideas (no status filter) so kanban columns are accurate
  const { data: allIdeas = [], isLoading } = useQuery({
    queryKey: ['ideas-admin', currentOrg?.id, searchQuery, selectedBusinessArea],
    queryFn: () => fetchIdeas(currentOrg!.id, {
      search: searchQuery || undefined,
      business_area: selectedBusinessArea ? [selectedBusinessArea as BusinessArea] : undefined,
    }),
    enabled: !!currentOrg,
  });

  // Filter out drafts
  const ideas = allIdeas.filter(i => i.status !== 'draft');

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

  const openStatusDialog = (idea: EnhancedIdea) => {
    setSelectedIdea(idea);
    setNewStatus(idea.status);
    setAdminNotes(idea.admin_notes || '');
    setRejectionReason(idea.rejection_reason || '');
    setStatusDialogOpen(true);
  };

  const kanbanColumns: { key: IdeaStatusExtended; label: string; color: string }[] = [
    { key: 'submitted', label: 'Submitted', color: 'border-t-blue-400' },
    { key: 'in_review', label: 'In Review', color: 'border-t-yellow-400' },
    { key: 'accepted', label: 'Accepted', color: 'border-t-green-400' },
    { key: 'in_progress', label: 'In Progress', color: 'border-t-purple-400' },
  ];

  const completedColumns: { key: IdeaStatusExtended; label: string; color: string }[] = [
    { key: 'done', label: 'Done', color: 'border-t-emerald-500' },
    { key: 'rejected', label: 'Rejected', color: 'border-t-red-400' },
  ];

  const allColumns = [...kanbanColumns, ...completedColumns];

  const handleDropStatus = async (status: IdeaStatusExtended) => {
    setDragOverColumn(null);
    if (!draggedIdeaId) return;

    const idea = ideas.find((i) => i.id === draggedIdeaId);
    if (!idea || idea.status === status) {
      setDraggedIdeaId(null);
      return;
    }

    if (status === 'rejected') {
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
        status,
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

        {/* Kanban Board */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : ideas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No ideas found</h3>
              <p className="text-muted-foreground">
                No ideas have been submitted yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-4" style={{ minWidth: `${allColumns.length * 280}px` }}>
              {allColumns.map((column) => {
                const columnIdeas = ideas.filter((idea) => idea.status === column.key);
                const isDragOver = dragOverColumn === column.key;
                return (
                  <div
                    key={column.key}
                    className="flex-1 min-w-[260px]"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverColumn(column.key);
                    }}
                    onDragLeave={() => setDragOverColumn(null)}
                    onDrop={() => handleDropStatus(column.key)}
                  >
                    <Card className={`h-full border-t-4 ${column.color} transition-shadow ${isDragOver ? 'ring-2 ring-primary/50 shadow-lg' : ''}`}>
                      <CardHeader className="pb-3 px-3 pt-3">
                        <CardTitle className="flex items-center justify-between text-sm font-semibold">
                          <span>{column.label}</span>
                          <Badge variant="secondary" className="text-xs">{columnIdeas.length}</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3">
                        <ScrollArea className="h-[calc(100vh-320px)]">
                          <div className="space-y-2 pr-2">
                            {columnIdeas.length === 0 ? (
                              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                Drop ideas here
                              </div>
                            ) : (
                              columnIdeas.map((idea) => (
                                <div
                                  key={idea.id}
                                  draggable
                                  onDragStart={() => setDraggedIdeaId(idea.id)}
                                  onDragEnd={() => {
                                    setDraggedIdeaId(null);
                                    setDragOverColumn(null);
                                  }}
                                  className={`cursor-grab active:cursor-grabbing rounded-lg border bg-card p-3 shadow-sm hover:shadow-md transition-shadow ${
                                    draggedIdeaId === idea.id ? 'opacity-50' : ''
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <p
                                      className="line-clamp-2 text-sm font-medium cursor-pointer hover:text-primary transition-colors"
                                      onClick={() => navigate(`/app/community/org/ideas/${idea.id}`)}
                                    >
                                      {idea.title}
                                    </p>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                                          <MoreHorizontal className="h-3.5 w-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => navigate(`/app/community/org/ideas/${idea.id}`)}>
                                          <Eye className="h-4 w-4 mr-2" />
                                          View Details
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => openStatusDialog(idea)}>
                                          <Clock className="h-4 w-4 mr-2" />
                                          Update Status
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="truncate max-w-[120px]">{idea.profile?.full_name || 'Unknown'}</span>
                                    <div className="flex items-center gap-2">
                                      {(idea.vote_count ?? 0) > 0 && (
                                        <span className="flex items-center gap-0.5">
                                          <ThumbsUp className="h-3 w-3" />
                                          {idea.vote_count}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {idea.business_area && (
                                    <Badge variant="outline" className="mt-2 text-[10px]">
                                      {BUSINESS_AREAS.find(a => a.value === idea.business_area)?.label || idea.business_area}
                                    </Badge>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Status update dialog */}
        <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update Idea Status</DialogTitle>
              <DialogDescription>
                {selectedIdea?.title}
              </DialogDescription>
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
                    {IDEA_STATUS_OPTIONS.filter(s => s.value !== 'draft').map((s) => (
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
              <Button
                variant="outline"
                onClick={() => setStatusDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => statusMutation.mutate()}
                disabled={statusMutation.isPending || (newStatus === 'rejected' && !rejectionReason)}
              >
                {statusMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
