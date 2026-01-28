import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FileUpload } from '@/components/ui/file-upload';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Users, BookOpen, TrendingUp, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';

export default function OrgDashboard() {
  const { currentOrg, refreshUserContext } = useAuth();
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalEnrollments: 0,
    completionRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      if (!currentOrg) {
        setLoading(false);
        return;
      }

      // Get total users
      const { count: totalUsers } = await supabase
        .from('org_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', currentOrg.id)
        .eq('status', 'active');

      // Get enrollments
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('status')
        .eq('org_id', currentOrg.id);

      const totalEnrollments = enrollments?.length || 0;
      const completedEnrollments = enrollments?.filter(e => e.status === 'completed').length || 0;
      const completionRate = totalEnrollments > 0 
        ? Math.round((completedEnrollments / totalEnrollments) * 100) 
        : 0;

      // Get active users (had activity in last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const { data: recentProgress } = await supabase
        .from('lesson_progress')
        .select('user_id')
        .eq('org_id', currentOrg.id)
        .gte('completed_at', sevenDaysAgo.toISOString());

      const activeUsers = new Set(recentProgress?.map(p => p.user_id)).size;

      setStats({
        totalUsers: totalUsers || 0,
        activeUsers,
        totalEnrollments,
        completionRate,
      });
      setLoading(false);
    };

    fetchStats();
  }, [currentOrg]);

  const handleLogoUpload = async (url: string | null, storagePath: string | null) => {
    if (!currentOrg || !url) return;
    
    setUploading(true);
    try {
      // For public bucket, construct the public URL
      const { data: { publicUrl } } = supabase.storage
        .from('org-logos')
        .getPublicUrl(storagePath!);

      const { error } = await supabase
        .from('organizations')
        .update({ logo_url: publicUrl })
        .eq('id', currentOrg.id);

      if (error) throw error;

      toast.success('Logo updated successfully');
      setLogoDialogOpen(false);
      // Refresh to get updated org data
      await refreshUserContext();
    } catch (error: any) {
      console.error('Error updating logo:', error);
      toast.error(error.message || 'Failed to update logo');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <AppLayout title="Organization Overview">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout title="Organization Overview">
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No organization selected.</p>
          <p className="text-sm text-muted-foreground">Join an organization to view its dashboard.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Organization Overview"
      breadcrumbs={[{ label: 'Organization' }]}
    >
      {/* Org Info */}
      <Card className="mb-6">
        <CardContent className="flex items-center gap-4 p-6">
          <div className="relative group shrink-0">
            {currentOrg?.logo_url ? (
              <img
                src={currentOrg.logo_url}
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
              <DialogContent>
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
                        <p className="text-xs text-muted-foreground">
                          Square image, 256×256px or larger
                        </p>
                        <p className="text-xs text-muted-foreground">
                          PNG or JPG format, max 2MB
                        </p>
                      </div>
                    </div>
                  </div>
                  <FileUpload
                    bucket="org-logos"
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
            <h2 className="font-display text-xl font-bold">{currentOrg?.name}</h2>
            <p className="text-sm text-muted-foreground">
              Organization ID: {currentOrg?.slug}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Members"
          value={stats.totalUsers}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Active (7 days)"
          value={stats.activeUsers}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Course Enrollments"
          value={stats.totalEnrollments}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          title="Completion Rate"
          value={`${stats.completionRate}%`}
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>
    </AppLayout>
  );
}
