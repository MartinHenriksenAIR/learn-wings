import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Loader2, Users, BarChart3, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { AnalyticsOverview } from '@/components/org-admin/analytics/AnalyticsOverview';
import { TeamPerformanceTab } from '@/components/org-admin/analytics/TeamPerformanceTab';
import { CourseProgressTab } from '@/components/org-admin/analytics/CourseProgressTab';

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
  const { currentOrg, isPlatformAdmin } = useAuth();
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

          for (const member of members) {
            const profile = member.profile as any;
            if (!profile) continue;

            const { data: userEnrollments } = await supabase
              .from('enrollments')
              .select('status')
              .eq('org_id', orgFilter)
              .eq('user_id', profile.id);

            const { data: userAttempts } = await supabase
              .from('quiz_attempts')
              .select('score')
              .eq('org_id', orgFilter)
              .eq('user_id', profile.id);

            const avgScore = userAttempts && userAttempts.length > 0
              ? Math.round(userAttempts.reduce((acc, a) => acc + a.score, 0) / userAttempts.length)
              : 0;

            userStatsData.push({
              id: profile.id,
              name: profile.full_name,
              department: profile.department || null,
              enrollments: userEnrollments?.length || 0,
              completed: userEnrollments?.filter(e => e.status === 'completed').length || 0,
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

  const pageTitle = isGlobalView ? 'Global Analytics' : 'Organization Analytics';
  const breadcrumbs = isGlobalView 
    ? [{ label: 'Platform Admin' }, { label: 'Global Analytics' }]
    : [{ label: 'Analytics' }];

  return (
    <AppLayout title={pageTitle} breadcrumbs={breadcrumbs}>
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
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-2">
            <Users className="h-4 w-4" />
            Team
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
