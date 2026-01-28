import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, TrendingUp, Award, BookOpen, Loader2, FileText } from 'lucide-react';

interface AnalyticsOverviewProps {
  stats: {
    totalUsers: number;
    activeUsers7Days: number;
    activeUsers30Days: number;
    avgQuizScore: number;
    completionRate: number;
  };
  isGlobalView: boolean;
  selectedOrgId: string;
  showComplianceReport: boolean;
  generatingReport: boolean;
  onGenerateReport: () => void;
}

export function AnalyticsOverview({
  stats,
  isGlobalView,
  selectedOrgId,
  showComplianceReport,
  generatingReport,
  onGenerateReport,
}: AnalyticsOverviewProps) {
  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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

      {/* Quick insights */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">7-day engagement rate</span>
                <span className="font-medium">
                  {stats.totalUsers > 0 
                    ? `${Math.round((stats.activeUsers7Days / stats.totalUsers) * 100)}%` 
                    : '0%'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">30-day engagement rate</span>
                <span className="font-medium">
                  {stats.totalUsers > 0 
                    ? `${Math.round((stats.activeUsers30Days / stats.totalUsers) * 100)}%` 
                    : '0%'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Learning Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Course completion rate</span>
                <span className="font-medium">{stats.completionRate}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Average quiz performance</span>
                <span className="font-medium">{stats.avgQuizScore}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Report Generation - Moved to bottom */}
      {showComplianceReport && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-base">AI Act Compliance</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Generate a PDF report documenting staff training completion status
              </p>
            </div>
            <Button
              onClick={onGenerateReport}
              disabled={generatingReport}
              variant="outline"
              className="gap-2"
            >
              {generatingReport ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {generatingReport ? 'Generating...' : 'Download Report'}
            </Button>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
