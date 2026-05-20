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
import { callApi, callApiRaw } from '@/lib/api-client';
import { Organization } from '@/lib/types';
import { Loader2, Users, BarChart3, BookOpen, Building2, Pencil, GraduationCap } from 'lucide-react';
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
      if (!isGlobalView && !currentOrg) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const orgFilter = effectiveOrgId;

      if (orgFilter) {
        // Org-specific view: fetch from Azure API
        try {
          const data = await callApi<{
            members: Array<{ user_id: string; full_name: string; email: string; department?: string }>;
            enrollments: Array<{ user_id: string; status: string; course_id: string }>;
            quizAttempts: Array<{ user_id: string; score: number }>;
          }>('/api/org-analytics-data', { orgId: orgFilter });

          const totalUsers = data.members.length;
          const totalEnrollments = data.enrollments.length;
          const completedEnrollments = data.enrollments.filter(e => e.status === 'completed').length;
          const completionRate = totalEnrollments > 0
            ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0;
          const avgQuizScore = data.quizAttempts.length > 0
            ? Math.round(data.quizAttempts.reduce((acc, a) => acc + a.score, 0) / data.quizAttempts.length) : 0;

          setStats({ totalUsers, activeUsers7Days: 0, activeUsers30Days: 0, avgQuizScore, completionRate });

          const depts = data.members.map(m => m.department).filter((d): d is string => Boolean(d));
          setDepartments([...new Set(depts)]);

          const enrollmentMap = new Map<string, { total: number; completed: number }>();
          data.enrollments.forEach(e => {
            const existing = enrollmentMap.get(e.user_id) || { total: 0, completed: 0 };
            existing.total += 1;
            if (e.status === 'completed') existing.completed += 1;
            enrollmentMap.set(e.user_id, existing);
          });

          const attemptMap = new Map<string, { totalScore: number; attempts: number }>();
          data.quizAttempts.forEach(a => {
            const existing = attemptMap.get(a.user_id) || { totalScore: 0, attempts: 0 };
            existing.totalScore += a.score;
            existing.attempts += 1;
            attemptMap.set(a.user_id, existing);
          });

          setUserStats(data.members.map(m => {
            const enrollStats = enrollmentMap.get(m.user_id) || { total: 0, completed: 0 };
            const attemptStats = attemptMap.get(m.user_id) || { totalScore: 0, attempts: 0 };
            return {
              id: m.user_id,
              name: m.full_name,
              department: m.department || null,
              enrollments: enrollStats.total,
              completed: enrollStats.completed,
              avgQuizScore: attemptStats.attempts > 0
                ? Math.round(attemptStats.totalScore / attemptStats.attempts) : 0,
            };
          }));
        } catch (err) {
          console.error('Failed to fetch analytics data:', err);
        }
      }
      // Global view (all orgs) not yet supported via API — show empty stats
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
      const response = await callApiRaw('/api/generate-compliance-report', { orgId: effectiveOrgId });
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
      // storagePath is the Azure blob path returned by file-upload component
      const logoUrl = `${import.meta.env.VITE_STORAGE_BASE_URL ?? ''}/${storagePath}`;

      const { error } = await supabase
        .from('organizations')
        .update({ logo_url: logoUrl })
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
        <TabsList className={`inline-flex h-11 w-auto gap-1 ${isGlobalView ? '' : ''}`}>
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          {!isGlobalView && (
            <TabsTrigger value="members" className="gap-2">
              <Users className="h-4 w-4 shrink-0" />
              Organization Members
            </TabsTrigger>
          )}
          <TabsTrigger value="team" className="gap-2">
            <GraduationCap className="h-4 w-4" />
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
