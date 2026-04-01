import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FileUpload } from '@/components/ui/file-upload';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { supabase } from '@/integrations/supabase/client';
import { Organization } from '@/lib/types';
import { Loader2, Users, BarChart3, BookOpen, Building2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { AnalyticsOverview } from '@/components/org-admin/analytics/AnalyticsOverview';
import { TeamPerformanceTab } from '@/components/org-admin/analytics/TeamPerformanceTab';
import { CourseProgressTab } from '@/components/org-admin/analytics/CourseProgressTab';
import { OrgMembersTab } from '@/components/org-admin/OrgMembersTab';

interface UserStats {
  id: string;
  name: string;
  department: string | null;
  enrollments: number;
  completed: number;
  avgQuizScore: number;
}

export default function OrgAnalytics() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isGlobalView = location.pathname === '/app/admin/analytics/global';
  const { currentOrg, isPlatformAdmin, refreshUserContext } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers7Days: 0,
    activeUsers30Days: 0,
    avgQuizScore: 0,
    completionRate: 0,
  });
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Sync tab with URL
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams({ tab: value });
  };

  // Fetch organizations for global view filter
  useEffect(() => {
    const fetchOrganizations = async () => {
      if (!isGlobalView || !isPlatformAdmin) return;
      
      const { data: orgs } = await supabase
        .from('organizations')
        .select('*')
        .order('name');
      if (orgs) {
        setOrganizations(orgs as Organization[]);
      }
    };
    fetchOrganizations();
  }, [isGlobalView, isPlatformAdmin]);

  // Determine which org ID to use for queries
  const effectiveOrgId = isGlobalView 
    ? (selectedOrgId === 'all' ? null : selectedOrgId)
    : currentOrg?.id;

  useEffect(() => {
    const fetchData = async () => {
      // For org-specific view, require currentOrg
      if (!isGlobalView && !currentOrg) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const orgFilter = effectiveOrgId;

      // Get total users
      let totalUsers = 0;
      if (orgFilter) {
        const { count } = await supabase
          .from('org_memberships')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgFilter)
          .eq('status', 'active');
        totalUsers = count || 0;
      } else if (isGlobalView) {
        const { count } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true });
        totalUsers = count || 0;
      }

      // Get active users in last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      let active7Query = supabase
        .from('lesson_progress')
        .select('user_id')
        .gte('completed_at', sevenDaysAgo.toISOString());
      if (orgFilter) {
        active7Query = active7Query.eq('org_id', orgFilter);
      }
      const { data: active7 } = await active7Query;
      const activeUsers7Days = new Set(active7?.map(p => p.user_id)).size;

      // Get active users in last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      let active30Query = supabase
        .from('lesson_progress')
        .select('user_id')
        .gte('completed_at', thirtyDaysAgo.toISOString());
      if (orgFilter) {
        active30Query = active30Query.eq('org_id', orgFilter);
      }
      const { data: active30 } = await active30Query;
      const activeUsers30Days = new Set(active30?.map(p => p.user_id)).size;

      // Get average quiz score
      let quizQuery = supabase.from('quiz_attempts').select('score');
      if (orgFilter) {
        quizQuery = quizQuery.eq('org_id', orgFilter);
      }
      const { data: quizAttempts } = await quizQuery;
      const avgQuizScore = quizAttempts && quizAttempts.length > 0
        ? Math.round(quizAttempts.reduce((acc, a) => acc + a.score, 0) / quizAttempts.length)
        : 0;

      // Get completion rate
      let enrollmentsQuery = supabase.from('enrollments').select('status');
      if (orgFilter) {
        enrollmentsQuery = enrollmentsQuery.eq('org_id', orgFilter);
      }
      const { data: enrollments } = await enrollmentsQuery;
      const totalEnrollments = enrollments?.length || 0;
      const completedEnrollments = enrollments?.filter(e => e.status === 'completed').length || 0;
      const completionRate = totalEnrollments > 0
        ? Math.round((completedEnrollments / totalEnrollments) * 100)
        : 0;

      setStats({
        totalUsers,
        activeUsers7Days,
        activeUsers30Days,
        avgQuizScore,
        completionRate,
      });

      // Get user stats for team performance
      let userStatsData: UserStats[] = [];
      let uniqueDepartments: string[] = [];

      if (orgFilter) {
        const { data: members } = await supabase
          .from('org_memberships')
          .select('user_id, profile:profiles(id, full_name, department)')
          .eq('org_id', orgFilter)
          .eq('status', 'active');

        if (members) {
          // Extract unique departments
          const depts = members
            .map(m => (m.profile as any)?.department)
            .filter((d): d is string => Boolean(d));
          uniqueDepartments = [...new Set(depts)];

          const memberIds = members
            .map((m) => (m.profile as any)?.id as string | undefined)
            .filter((id): id is string => Boolean(id));

          let allEnrollments: { user_id: string; status: string }[] = [];
          let allAttempts: { user_id: string; score: number }[] = [];
          if (memberIds.length > 0) {
            const enrollmentPromise = supabase
              .from('enrollments')
              .select('user_id, status')
              .eq('org_id', orgFilter)
              .in('user_id', memberIds);
            const attemptsPromise = supabase
              .from('quiz_attempts')
              .select('user_id, score')
              .eq('org_id', orgFilter)
              .in('user_id', memberIds);
            const [{ data: enrollmentData }, { data: attemptsData }] = await Promise.all([
              enrollmentPromise,
              attemptsPromise,
            ]);
            allEnrollments = enrollmentData || [];
            allAttempts = attemptsData || [];
          }

          const enrollmentMap = new Map<string, { total: number; completed: number }>();
          allEnrollments.forEach((e) => {
            const existing = enrollmentMap.get(e.user_id) || { total: 0, completed: 0 };
            existing.total += 1;
            if (e.status === 'completed') existing.completed += 1;
            enrollmentMap.set(e.user_id, existing);
          });

          const attemptMap = new Map<string, { totalScore: number; attempts: number }>();
          allAttempts.forEach((a) => {
            const existing = attemptMap.get(a.user_id) || { totalScore: 0, attempts: 0 };
            existing.totalScore += a.score;
            existing.attempts += 1;
            attemptMap.set(a.user_id, existing);
          });

          for (const member of members) {
            const profile = member.profile as any;
            if (!profile) continue;

            const enrollmentStats = enrollmentMap.get(profile.id) || { total: 0, completed: 0 };
            const attemptStats = attemptMap.get(profile.id) || { totalScore: 0, attempts: 0 };
            const avgScore = attemptStats.attempts > 0
              ? Math.round(attemptStats.totalScore / attemptStats.attempts)
              : 0;

            userStatsData.push({
              id: profile.id,
              name: profile.full_name,
              department: profile.department || null,
              enrollments: enrollmentStats.total,
              completed: enrollmentStats.completed,
              avgQuizScore: avgScore,
            });
          }
        }
      }

      setDepartments(uniqueDepartments);
      setUserStats(userStatsData);
      setLoading(false);
    };

    fetchData();
  }, [currentOrg, effectiveOrgId, isGlobalView]);

  // Generate compliance report
  const handleGenerateReport = async () => {
    if (!effectiveOrgId) {
      toast.error('Please select an organization');
      return;
    }

    setGeneratingReport(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please log in to generate reports');
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-compliance-report`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ orgId: effectiveOrgId }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate report');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-act-compliance-report-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Compliance report downloaded successfully');
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate report');
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleLogoUpload = async (_url: string | null, storagePath: string | null) => {
    if (!currentOrg || !storagePath) return;

    setUploading(true);
    try {
      const { data: { publicUrl } } = supabase.storage
        .from('org-logos')
        .getPublicUrl(storagePath);

      const { error } = await supabase
        .from('organizations')
        .update({ logo_url: publicUrl })
        .eq('id', currentOrg.id);

      if (error) throw error;

      toast.success('Logo updated successfully');
      setLogoDialogOpen(false);
      await refreshUserContext();
    } catch (error: any) {
      console.error('Error updating logo:', error);
      toast.error(error.message || 'Failed to update logo');
    } finally {
      setUploading(false);
    }
  };

  // Redirect if analytics are disabled
  if (!settingsLoading && !features.analytics_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (loading || settingsLoading) {
    return (
      <AppLayout title="Analytics" breadcrumbs={[{ label: 'Analytics' }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  // For org-specific view, require currentOrg
  if (!isGlobalView && !currentOrg) {
    return (
      <AppLayout title="Analytics" breadcrumbs={[{ label: 'Analytics' }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No organization selected.</p>
          <p className="text-sm text-muted-foreground">Join an organization to view analytics.</p>
        </div>
      </AppLayout>
    );
  }

  const pageTitle = isGlobalView ? 'Global Analytics' : 'Organization';
  const breadcrumbs = isGlobalView 
    ? [{ label: 'Platform Admin' }, { label: 'Global Analytics' }]
    : [{ label: 'Organization' }];

  return (
    <AppLayout title={pageTitle} breadcrumbs={breadcrumbs}>
      {!isGlobalView && currentOrg && (
        <Card className="mb-6">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="relative group shrink-0">
              {currentOrg.logo_url ? (
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
                          <p className="text-xs text-muted-foreground">Square image, 256×256px or larger</p>
                          <p className="text-xs text-muted-foreground">PNG or JPG format, max 2MB</p>
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
              <h2 className="font-display text-xl font-bold">{currentOrg.name}</h2>
              <p className="text-sm text-muted-foreground">Organization ID: {currentOrg.slug}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Organization Filter for Global View */}
      {isGlobalView && isPlatformAdmin && (
        <div className="mb-6 flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Filter by organization:</span>
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="All Organizations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Organizations</SelectItem>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className={`grid w-full ${isGlobalView ? 'max-w-md grid-cols-3' : 'max-w-2xl grid-cols-4'}`}>
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          {!isGlobalView && (
            <TabsTrigger value="members" className="gap-2">
              <Users className="h-4 w-4" />
              Organization Members
            </TabsTrigger>
          )}
          <TabsTrigger value="team" className="gap-2">
            <Users className="h-4 w-4" />
            Learning Progress
          </TabsTrigger>
          <TabsTrigger value="courses" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Courses
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <AnalyticsOverview
            stats={stats}
            isGlobalView={isGlobalView}
            selectedOrgId={selectedOrgId}
            showComplianceReport={!isGlobalView && !!currentOrg}
            generatingReport={generatingReport}
            onGenerateReport={handleGenerateReport}
          />
        </TabsContent>

        {!isGlobalView && (
          <TabsContent value="members">
            <OrgMembersTab />
          </TabsContent>
        )}

        <TabsContent value="team">
          {effectiveOrgId ? (
            <TeamPerformanceTab
              userStats={userStats}
              departments={departments}
              orgId={effectiveOrgId}
            />
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              Select an organization to view team performance.
            </div>
          )}
        </TabsContent>

        <TabsContent value="courses">
          {effectiveOrgId ? (
            <CourseProgressTab orgId={effectiveOrgId} />
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              Select an organization to view course progress.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
