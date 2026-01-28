import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
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
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { supabase } from '@/integrations/supabase/client';
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
  const { currentOrg } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const fetchData = async () => {
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

      // Get active users in last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const { data: active7 } = await supabase
        .from('lesson_progress')
        .select('user_id')
        .eq('org_id', currentOrg.id)
        .gte('completed_at', sevenDaysAgo.toISOString());
      const activeUsers7Days = new Set(active7?.map(p => p.user_id)).size;

      // Get active users in last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data: active30 } = await supabase
        .from('lesson_progress')
        .select('user_id')
        .eq('org_id', currentOrg.id)
        .gte('completed_at', thirtyDaysAgo.toISOString());
      const activeUsers30Days = new Set(active30?.map(p => p.user_id)).size;

      // Get average quiz score
      const { data: quizAttempts } = await supabase
        .from('quiz_attempts')
        .select('score')
        .eq('org_id', currentOrg.id);
      const avgQuizScore = quizAttempts && quizAttempts.length > 0
        ? Math.round(quizAttempts.reduce((acc, a) => acc + a.score, 0) / quizAttempts.length)
        : 0;

      // Get completion rate
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('status')
        .eq('org_id', currentOrg.id);
      const totalEnrollments = enrollments?.length || 0;
      const completedEnrollments = enrollments?.filter(e => e.status === 'completed').length || 0;
      const completionRate = totalEnrollments > 0
        ? Math.round((completedEnrollments / totalEnrollments) * 100)
        : 0;

      setStats({
        totalUsers: totalUsers || 0,
        activeUsers7Days,
        activeUsers30Days,
        avgQuizScore,
        completionRate,
      });

      // Get course stats
      const { data: orgCourses } = await supabase
        .from('org_course_access')
        .select('course_id, course:courses(id, title)')
        .eq('org_id', currentOrg.id)
        .eq('access', 'enabled');

      if (orgCourses) {
        const courseStatsData: CourseStats[] = [];
        
        for (const access of orgCourses) {
          const course = access.course as any;
          if (!course) continue;

          // Get enrollments for this course
          const { data: courseEnrollments } = await supabase
            .from('enrollments')
            .select('*')
            .eq('org_id', currentOrg.id)
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

        setCourseStats(courseStatsData);
      }

      // Get user stats (top 10)
      const { data: members } = await supabase
        .from('org_memberships')
        .select('user_id, profile:profiles(id, full_name)')
        .eq('org_id', currentOrg.id)
        .eq('status', 'active')
        .limit(10);

      if (members) {
        const userStatsData: UserStats[] = [];

        for (const member of members) {
          const profile = member.profile as any;
          if (!profile) continue;

          const { data: userEnrollments } = await supabase
            .from('enrollments')
            .select('*')
            .eq('org_id', currentOrg.id)
            .eq('user_id', profile.id);

          const { data: userAttempts } = await supabase
            .from('quiz_attempts')
            .select('score')
            .eq('org_id', currentOrg.id)
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

        setUserStats(userStatsData);
      }

      setLoading(false);
    };

    fetchData();
  }, [currentOrg]);

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

  if (!currentOrg) {
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

  return (
    <AppLayout title="Organization Analytics" breadcrumbs={[{ label: 'Analytics' }]}>
      {/* Summary Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Total Members"
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

        {/* User Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team Performance</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
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
          </CardContent>
        </Card>
      </div>

      {selectedUser && currentOrg && (
        <UserProgressDialog
          userId={selectedUser.id}
          userName={selectedUser.name}
          orgId={currentOrg.id}
          open={progressDialogOpen}
          onOpenChange={setProgressDialogOpen}
        />
      )}
    </AppLayout>
  );
}
