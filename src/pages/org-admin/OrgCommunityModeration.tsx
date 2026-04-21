import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { CommunityReport, ReportStatus } from '@/lib/community-types';
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
  AlertTriangle,
  MessageSquare,
  FileText,
  Flag,
} from 'lucide-react';

interface ReportWithDetails extends Omit<CommunityReport, 'reporter'> {
  reporter?: { id: string; full_name: string };
}

export default function OrgCommunityModeration() {
  const { currentOrg, profile } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<ReportStatus>('pending');
  const [selectedReport, setSelectedReport] = useState<ReportWithDetails | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');

  // Fetch reports for org
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['org-reports', currentOrg?.id, activeTab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('community_reports')
        .select(`
          *,
          reporter:profiles!community_reports_reporter_user_id_fkey(id, full_name)
        `)
        .eq('org_id', currentOrg!.id)
        .eq('status', activeTab)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ReportWithDetails[];
    },
    enabled: !!currentOrg,
  });

  // Update report status
  const updateReportMutation = useMutation({
    mutationFn: async ({ 
      reportId, 
      status, 
      notes 
    }: { 
      reportId: string; 
      status: ReportStatus; 
      notes?: string;
    }) => {
      const { error } = await supabase
        .from('community_reports')
        .update({
          status,
          admin_notes: notes || null,
          reviewed_by: profile?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-reports'] });
      setReviewDialogOpen(false);
      setSelectedReport(null);
      toast.success('Report updated');
    },
    onError: () => {
      toast.error('Failed to update report');
    },
  });

  // Hide/show content
  const toggleContentVisibility = useMutation({
    mutationFn: async ({ 
      type, 
      id, 
      hide 
    }: { 
      type: 'post' | 'comment'; 
      id: string; 
      hide: boolean;
    }) => {
      const table = type === 'post' ? 'community_posts' : 'community_comments';
      const { error } = await supabase
        .from(table)
        .update({ is_hidden: hide })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-reports'] });
      toast.success('Content visibility updated');
    },
    onError: () => {
      toast.error('Failed to update content');
    },
  });

  // Lock/unlock post comments
  const togglePostLock = useMutation({
    mutationFn: async ({ postId, lock }: { postId: string; lock: boolean }) => {
      const { error } = await supabase
        .from('community_posts')
        .update({ is_locked: lock })
        .eq('id', postId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-reports'] });
      toast.success('Post lock status updated');
    },
    onError: () => {
      toast.error('Failed to update post');
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

  const getTargetTypeIcon = (type: string) => {
    return type === 'post' ? <FileText className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />;
  };

  const openContentInNewTab = (report: ReportWithDetails) => {
    const path = `/app/community/org/posts/${report.target_id}`;
    window.open(path, '_blank', 'noopener,noreferrer');
  };

  if (!currentOrg) {
    return (
      <AppLayout>
        <div className="container mx-auto py-12 text-center">
          <h1 className="text-2xl font-bold mb-2">No Organization Selected</h1>
          <p className="text-muted-foreground">Please select an organization.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto py-6 px-4">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Community Moderation</h1>
          <p className="text-muted-foreground">
            Review reported content in {currentOrg.name}'s community
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportStatus)} className="mb-6">
          <TabsList>
            <TabsTrigger value="pending" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Pending
            </TabsTrigger>
            <TabsTrigger value="reviewed" className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Reviewed
            </TabsTrigger>
            <TabsTrigger value="dismissed" className="flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Dismissed
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Reports list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Flag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No reports</h3>
              <p className="text-muted-foreground">
                {activeTab === 'pending' 
                  ? 'No pending reports to review.'
                  : `No ${activeTab} reports found.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => (
              <Card key={report.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-muted rounded-lg">
                        {getTargetTypeIcon(report.target_type)}
                      </div>
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          Reported {report.target_type}
                          <Badge variant={report.status === 'pending' ? 'destructive' : 'secondary'}>
                            {report.status}
                          </Badge>
                        </CardTitle>
                        <CardDescription>
                          Reported by {report.reporter?.full_name || 'Unknown'} • {' '}
                          {formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openContentInNewTab(report)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View content</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => toggleContentVisibility.mutate({
                              type: report.target_type,
                              id: report.target_id,
                              hide: true,
                            })}
                            disabled={toggleContentVisibility.isPending}
                          >
                            <EyeOff className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Hide content</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => toggleContentVisibility.mutate({
                              type: report.target_type,
                              id: report.target_id,
                              hide: false,
                            })}
                            disabled={toggleContentVisibility.isPending}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Show content</TooltipContent>
                      </Tooltip>

                      {report.target_type === 'post' && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => togglePostLock.mutate({
                                  postId: report.target_id,
                                  lock: true,
                                })}
                                disabled={togglePostLock.isPending}
                              >
                                <Lock className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Lock comments</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => togglePostLock.mutate({
                                  postId: report.target_id,
                                  lock: false,
                                })}
                                disabled={togglePostLock.isPending}
                              >
                                <Unlock className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Unlock comments</TooltipContent>
                          </Tooltip>
                        </>
                      )}

                      {report.status === 'pending' && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openReviewDialog(report)}
                                disabled={updateReportMutation.isPending}
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Mark reviewed</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => updateReportMutation.mutate({
                                  reportId: report.id,
                                  status: 'dismissed',
                                })}
                                disabled={updateReportMutation.isPending}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Dismiss report</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-sm font-medium mb-1">Report Reason:</p>
                    <p className="text-sm text-muted-foreground">{report.reason}</p>
                  </div>
                  {report.admin_notes && (
                    <div className="mt-3 p-3 border rounded-lg">
                      <p className="text-sm font-medium mb-1">Admin Notes:</p>
                      <p className="text-sm text-muted-foreground">{report.admin_notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Review dialog */}
        <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Review Report</DialogTitle>
              <DialogDescription>
                Add notes and mark this report as reviewed or dismissed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Admin Notes</label>
                <Textarea
                  placeholder="Add any notes about how this was handled..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setReviewDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={handleDismiss}
                disabled={updateReportMutation.isPending}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Dismiss
              </Button>
              <Button
                onClick={handleMarkReviewed}
                disabled={updateReportMutation.isPending}
              >
                {updateReportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Mark Reviewed
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
