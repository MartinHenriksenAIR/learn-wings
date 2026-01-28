import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Organization } from '@/lib/types';
import { Building2, Users, BookOpen, TrendingUp, Loader2 } from 'lucide-react';

interface OrgSummary {
  id: string;
  name: string;
  users: number;
  enrollments: number;
  completionRate: number;
}

export default function PlatformDashboard() {
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [stats, setStats] = useState({
    totalOrgs: 0,
    totalUsers: 0,
    totalCourses: 0,
    totalEnrollments: 0,
    globalCompletionRate: 0,
  });
  const [orgSummaries, setOrgSummaries] = useState<OrgSummary[]>([]);

  // Fetch organizations list once
  useEffect(() => {
    const fetchOrganizations = async () => {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('*')
        .order('name');
      if (orgs) {
        setOrganizations(orgs as Organization[]);
      }
    };
    fetchOrganizations();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      const isFiltered = selectedOrgId !== 'all';

      // Get total orgs (always global)
      const { count: totalOrgs } = await supabase
        .from('organizations')
        .select('*', { count: 'exact', head: true });

      // Get total users - filtered by org membership if org selected
      let totalUsers = 0;
      if (isFiltered) {
        const { count } = await supabase
          .from('org_memberships')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', selectedOrgId)
          .eq('status', 'active');
        totalUsers = count || 0;
      } else {
        const { count } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true });
        totalUsers = count || 0;
      }

      // Get total courses (always global - courses are shared)
      const { count: totalCourses } = await supabase
        .from('courses')
        .select('*', { count: 'exact', head: true });

      // Get enrollments - filtered by org if selected
      let enrollmentsQuery = supabase.from('enrollments').select('status');
      if (isFiltered) {
        enrollmentsQuery = enrollmentsQuery.eq('org_id', selectedOrgId);
      }
      const { data: allEnrollments } = await enrollmentsQuery;
      
      const totalEnrollments = allEnrollments?.length || 0;
      const completedEnrollments = allEnrollments?.filter(e => e.status === 'completed').length || 0;
      const globalCompletionRate = totalEnrollments > 0
        ? Math.round((completedEnrollments / totalEnrollments) * 100)
        : 0;

      setStats({
        totalOrgs: totalOrgs || 0,
        totalUsers,
        totalCourses: totalCourses || 0,
        totalEnrollments,
        globalCompletionRate,
      });

      // Get org summaries - only for selected org or top 10 if "all"
      let orgsToShow: Organization[] = [];
      if (isFiltered) {
        const selectedOrg = organizations.find(o => o.id === selectedOrgId);
        if (selectedOrg) orgsToShow = [selectedOrg];
      } else {
        const { data: orgs } = await supabase
          .from('organizations')
          .select('*')
          .limit(10);
        orgsToShow = (orgs || []) as Organization[];
      }

      const summaries: OrgSummary[] = [];

      for (const org of orgsToShow) {
        const { count: users } = await supabase
          .from('org_memberships')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', org.id)
          .eq('status', 'active');

        const { data: orgEnrollments } = await supabase
          .from('enrollments')
          .select('status')
          .eq('org_id', org.id);

        const enrollments = orgEnrollments?.length || 0;
        const completed = orgEnrollments?.filter(e => e.status === 'completed').length || 0;
        const completionRate = enrollments > 0 ? Math.round((completed / enrollments) * 100) : 0;

        summaries.push({
          id: org.id,
          name: org.name,
          users: users || 0,
          enrollments,
          completionRate,
        });
      }

      setOrgSummaries(summaries);
      setLoading(false);
    };

    fetchData();
  }, [selectedOrgId, organizations]);

  if (loading) {
    return (
      <AppLayout title="Platform Overview">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Platform Overview"
      breadcrumbs={[{ label: 'Platform Admin' }]}
    >
      {/* Organization Filter */}
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

      {/* Summary Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Organizations"
          value={selectedOrgId === 'all' ? stats.totalOrgs : 1}
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          title={selectedOrgId === 'all' ? 'Total Users' : 'Org Users'}
          value={stats.totalUsers}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Courses"
          value={stats.totalCourses}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          title="Enrollments"
          value={stats.totalEnrollments}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Completion Rate"
          value={`${stats.globalCompletionRate}%`}
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      {/* Organization Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selectedOrgId === 'all' ? 'Organization Performance' : 'Organization Details'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {orgSummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No organizations yet.</p>
          ) : (
            <div className="space-y-4">
              {orgSummaries.map((org) => (
                <div key={org.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{org.name}</span>
                      <span className="ml-2 text-sm text-muted-foreground">
                        {org.users} users • {org.enrollments} enrollments
                      </span>
                    </div>
                    <span className="text-sm font-medium">{org.completionRate}%</span>
                  </div>
                  <Progress value={org.completionRate} className="h-2" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
