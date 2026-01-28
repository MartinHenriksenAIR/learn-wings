import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Users, TrendingUp, Award, BookOpen, Loader2, ChevronRight } from 'lucide-react';
import { UserProgressDialog } from '@/components/org-admin/UserProgressDialog';

interface CourseStats {
  id: string;
  title: string;
  enrolled: number;
  completed: number;
  avgProgress: number;
}

interface UserStats {
  id: string;
  name: string;
  enrollments: number;
  completed: number;
  avgQuizScore: number;
}

export default function OrgAnalytics() {
  const location = useLocation();
  const isGlobalView = location.pathname === '/app/admin/analytics/global';
  const { currentOrg, isPlatformAdmin } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers7Days: 0,
    activeUsers30Days: 0,
    avgQuizScore: 0,
    completionRate: 0,
  });
  const [courseStats, setCourseStats] = useState<CourseStats[]>([]);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserStats | null>(null);
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);

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

      // Build query filters based on context
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

      // Get course stats
      let courseStatsData: CourseStats[] = [];
      
      if (orgFilter) {
        // Specific org: get courses with access
        const { data: orgCourses } = await supabase
          .from('org_course_access')
          .select('course_id, course:courses(id, title)')
          .eq('org_id', orgFilter)
          .eq('access', 'enabled');

        if (orgCourses) {
          for (const access of orgCourses) {
            const course = access.course as any;
            if (!course) continue;

            const { data: courseEnrollments } = await supabase
              .from('enrollments')
              .select('*')
              .eq('org_id', orgFilter)
              .eq('course_id', course.id);

            const enrolled = courseEnrollments?.length || 0;
            const completed = courseEnrollments?.filter(e => e.status === 'completed').length || 0;

            courseStatsData.push({
              id: course.id,
              title: course.title,
              enrolled,
              completed,
              avgProgress: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
            });
          }
        }
      } else if (isGlobalView) {
        // Global view: get all courses
        const { data: allCourses } = await supabase
          .from('courses')
          .select('id, title')
          .limit(10);

        if (allCourses) {
          for (const course of allCourses) {
            const { data: courseEnrollments } = await supabase
              .from('enrollments')
              .select('status')
              .eq('course_id', course.id);

            const enrolled = courseEnrollments?.length || 0;
            const completed = courseEnrollments?.filter(e => e.status === 'completed').length || 0;

            courseStatsData.push({
              id: course.id,
              title: course.title,
              enrolled,
              completed,
              avgProgress: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
            });
          }
        }
      }

      setCourseStats(courseStatsData);

      // Get user stats (top 10)
      let userStatsData: UserStats[] = [];

      if (orgFilter) {
        const { data: members } = await supabase
          .from('org_memberships')
          .select('user_id, profile:profiles(id, full_name)')
          .eq('org_id', orgFilter)
          .eq('status', 'active')
          .limit(10);

        if (members) {
          for (const member of members) {
            const profile = member.profile as any;
            if (!profile) continue;

            const { data: userEnrollments } = await supabase
              .from('enrollments')
              .select('*')
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
              enrollments: userEnrollments?.length || 0,
              completed: userEnrollments?.filter(e => e.status === 'completed').length || 0,
              avgQuizScore: avgScore,
            });
          }
        }
      }
      // For global "all" view, we skip user-level stats as it would be too broad

      setUserStats(userStatsData);
      setLoading(false);
    };

    fetchData();
  }, [currentOrg, effectiveOrgId, isGlobalView]);

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

      {/* Summary Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title={isGlobalView && selectedOrgId === 'all' ? 'Total Users' : 'Total Members'}
          value={stats.totalUsers}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Active (7 days)"
          value={stats.activeUsers7Days}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Active (30 days)"
          value={stats.activeUsers30Days}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Completion Rate"
          value={`${stats.completionRate}%`}
          icon={<Award className="h-5 w-5" />}
        />
        <StatCard
          title="Avg Quiz Score"
          value={`${stats.avgQuizScore}%`}
          icon={<BookOpen className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Course Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Course Progress</CardTitle>
          </CardHeader>
          <CardContent>
            {courseStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No courses available yet.</p>
            ) : (
              <div className="space-y-4">
                {courseStats.map((course) => (
                  <div key={course.id} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{course.title}</span>
                      <span className="text-muted-foreground">
                        {course.completed}/{course.enrolled} completed
                      </span>
                    </div>
                    <Progress value={course.avgProgress} className="h-2" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* User Performance - Only show when org is selected */}
        {(effectiveOrgId || !isGlobalView) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Team Performance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {userStats.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No user data available.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Courses</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Avg Score</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userStats.map((user) => (
                      <TableRow
                        key={user.id}
                        className="cursor-pointer"
                        onClick={() => {
                          setSelectedUser(user);
                          setProgressDialogOpen(true);
                        }}
                      >
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell className="text-right">{user.enrollments}</TableCell>
                        <TableCell className="text-right">{user.completed}</TableCell>
                        <TableCell className="text-right">{user.avgQuizScore}%</TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Show message when viewing all orgs in global view */}
        {isGlobalView && selectedOrgId === 'all' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Team Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Select a specific organization to view individual user performance.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {selectedUser && effectiveOrgId && (
        <UserProgressDialog
          userId={selectedUser.id}
          userName={selectedUser.name}
          orgId={effectiveOrgId}
          open={progressDialogOpen}
          onOpenChange={setProgressDialogOpen}
        />
      )}
    </AppLayout>
  );
}
