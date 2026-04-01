import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  MessageSquare,
  ThumbsUp,
  Lightbulb,
  FileText,
  Inbox,
  Archive,
} from 'lucide-react';

export default function OrgIdeasManagement() {
  const navigate = useNavigate();
  const { currentOrg } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>('inbox');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBusinessArea, setSelectedBusinessArea] = useState<string>('');
  const [draggedIdeaId, setDraggedIdeaId] = useState<string | null>(null);
  
  // Status update dialog
  const [selectedIdea, setSelectedIdea] = useState<EnhancedIdea | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<IdeaStatusExtended>('submitted');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Tab status mappings
  const tabStatusFilters: Record<string, IdeaStatusExtended[]> = {
    inbox: ['submitted', 'in_review'],
    backlog: ['accepted', 'in_progress'],
    completed: ['done'],
    rejected: ['rejected'],
    all: [],
  };

  // Fetch ideas
  const { data: ideas = [], isLoading } = useQuery({
    queryKey: ['ideas-admin', currentOrg?.id, activeTab, searchQuery, selectedBusinessArea],
    queryFn: () => fetchIdeas(currentOrg!.id, {
      status: tabStatusFilters[activeTab].length > 0 ? tabStatusFilters[activeTab] : undefined,
      search: searchQuery || undefined,
      business_area: selectedBusinessArea ? [selectedBusinessArea as BusinessArea] : undefined,
    }),
    enabled: !!currentOrg,
  });

  // Filter out drafts for all view
  const filteredIdeas = activeTab === 'all' 
    ? ideas.filter((i) => i.status !== 'draft')
    : ideas;

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

  const quickStatusChange = (idea: EnhancedIdea, status: IdeaStatusExtended) => {
    setSelectedIdea(idea);
    setNewStatus(status);
    setAdminNotes(idea.admin_notes || '');
    setRejectionReason('');
    
    if (status === 'rejected') {
      setStatusDialogOpen(true);
    } else {
      // Directly update without dialog
      updateIdeaStatus(idea.id, {
        status,
        admin_notes: idea.admin_notes || undefined,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['ideas-admin'] });
        toast.success('Status updated');
      }).catch(() => {
        toast.error('Failed to update status');
      });
    }
  };

  const kanbanColumns: { key: IdeaStatusExtended; label: string }[] = [
    { key: 'submitted', label: 'Submitted' },
    { key: 'in_review', label: 'In Review' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'done', label: 'Done' },
    { key: 'rejected', label: 'Rejected' },
  ];

  const handleDropStatus = async (status: IdeaStatusExtended) => {
    if (!draggedIdeaId) return;

    const idea = filteredIdeas.find((i) => i.id === draggedIdeaId);
    if (!idea || idea.status === status) {
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

  const getBusinessAreaLabel = (value: string | null) => {
    if (!value) return '-';
    return BUSINESS_AREAS.find((a) => a.value === value)?.label || value;
  };

  const getTabIcon = (tab: string) => {
    switch (tab) {
      case 'inbox': return <Inbox className="h-4 w-4" />;
      case 'backlog': return <FileText className="h-4 w-4" />;
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'rejected': return <XCircle className="h-4 w-4" />;
      default: return <Lightbulb className="h-4 w-4" />;
    }
  };

  const getTabCount = (tab: string) => {
    const statuses = tabStatusFilters[tab];
    if (statuses.length === 0) return ideas.filter(i => i.status !== 'draft').length;
    return ideas.filter((i) => statuses.includes(i.status)).length;
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

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="inbox" className="flex items-center gap-2">
              {getTabIcon('inbox')}
              <span className="hidden sm:inline">Inbox</span>
              <Badge variant="secondary" className="ml-1">{getTabCount('inbox')}</Badge>
            </TabsTrigger>
            <TabsTrigger value="backlog" className="flex items-center gap-2">
              {getTabIcon('backlog')}
              <span className="hidden sm:inline">Backlog</span>
              <Badge variant="secondary" className="ml-1">{getTabCount('backlog')}</Badge>
            </TabsTrigger>
            <TabsTrigger value="completed" className="flex items-center gap-2">
              {getTabIcon('completed')}
              <span className="hidden sm:inline">Done</span>
              <Badge variant="secondary" className="ml-1">{getTabCount('completed')}</Badge>
            </TabsTrigger>
            <TabsTrigger value="rejected" className="flex items-center gap-2">
              {getTabIcon('rejected')}
              <span className="hidden sm:inline">Rejected</span>
              <Badge variant="secondary" className="ml-1">{getTabCount('rejected')}</Badge>
            </TabsTrigger>
            <TabsTrigger value="all" className="flex items-center gap-2">
              {getTabIcon('all')}
              <span className="hidden sm:inline">All</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mb-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant={viewMode === 'list' ? 'default' : 'outline'}
            onClick={() => setViewMode('list')}
          >
            List View
          </Button>
          <Button
            type="button"
            variant={viewMode === 'kanban' ? 'default' : 'outline'}
            onClick={() => setViewMode('kanban')}
          >
            Kanban View
          </Button>
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

        {/* Ideas table / board */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredIdeas.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No ideas found</h3>
              <p className="text-muted-foreground">
                {activeTab === 'inbox' 
                  ? 'No ideas are waiting for review.'
                  : 'No ideas match the current filters.'}
              </p>
            </CardContent>
          </Card>
        ) : viewMode === 'kanban' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {kanbanColumns.map((column) => {
              const columnIdeas = filteredIdeas.filter((idea) => idea.status === column.key);
              return (
                <Card
                  key={column.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropStatus(column.key)}
                  className="min-h-[240px]"
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>{column.label}</span>
                      <Badge variant="secondary">{columnIdeas.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {columnIdeas.length === 0 ? (
                      <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
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
                          className="cursor-move rounded border p-3 hover:bg-muted/50"
                        >
                          <p className="line-clamp-2 font-medium">{idea.title}</p>
                          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{idea.profile?.full_name || 'Unknown'}</span>
                            <span>{idea.vote_count || 0} 👍</span>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Idea</TableHead>
                  <TableHead className="hidden md:table-cell">Submitter</TableHead>
                  <TableHead className="hidden lg:table-cell">Business Area</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell text-center">
                    <ThumbsUp className="h-4 w-4 mx-auto" />
                  </TableHead>
                  <TableHead className="hidden md:table-cell text-center">
                    <MessageSquare className="h-4 w-4 mx-auto" />
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredIdeas.map((idea) => (
                  <TableRow 
                    key={idea.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/app/community/org/ideas/${idea.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium line-clamp-1">{idea.title}</div>
                      {idea.admin_notes && (
                        <Badge variant="outline" className="mt-1 text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          Has notes
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {idea.profile?.full_name || 'Unknown'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {getBusinessAreaLabel(idea.business_area)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <IdeaStatusBadge status={idea.status} size="sm" />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-center text-muted-foreground">
                      {idea.vote_count || 0}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-center text-muted-foreground">
                      {idea.comment_count || 0}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                      {idea.submitted_at 
                        ? formatDistanceToNow(new Date(idea.submitted_at), { addSuffix: true })
                        : formatDistanceToNow(new Date(idea.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
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
                          {idea.status === 'submitted' && (
                            <>
                              <DropdownMenuItem onClick={() => quickStatusChange(idea, 'in_review')}>
                                <Clock className="h-4 w-4 mr-2" />
                                Mark In Review
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => quickStatusChange(idea, 'accepted')}>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Accept
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => quickStatusChange(idea, 'rejected')}
                                className="text-destructive"
                              >
                                <XCircle className="h-4 w-4 mr-2" />
                                Reject
                              </DropdownMenuItem>
                            </>
                          )}
                          {idea.status === 'in_review' && (
                            <>
                              <DropdownMenuItem onClick={() => quickStatusChange(idea, 'accepted')}>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Accept
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => quickStatusChange(idea, 'rejected')}
                                className="text-destructive"
                              >
                                <XCircle className="h-4 w-4 mr-2" />
                                Reject
                              </DropdownMenuItem>
                            </>
                          )}
                          {idea.status === 'accepted' && (
                            <DropdownMenuItem onClick={() => quickStatusChange(idea, 'in_progress')}>
                              <Clock className="h-4 w-4 mr-2" />
                              Mark In Progress
                            </DropdownMenuItem>
                          )}
                          {idea.status === 'in_progress' && (
                            <DropdownMenuItem onClick={() => quickStatusChange(idea, 'done')}>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Mark Done
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
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
