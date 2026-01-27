import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Users, BookOpen, TrendingUp, Loader2 } from 'lucide-react';

export default function OrgDashboard() {
  const { currentOrg } = useAuth();
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalEnrollments: 0,
    completionRate: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!currentOrg) return;

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

  if (loading) {
    return (
      <AppLayout title="Organization Overview">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
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
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
            <Building2 className="h-8 w-8 text-primary" />
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
