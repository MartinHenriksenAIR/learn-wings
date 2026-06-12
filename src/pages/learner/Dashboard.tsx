import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { ProgressRing } from '@/components/ui/progress-ring';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { callApi, callApiRaw } from '@/lib/api-client';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import { Enrollment, Course } from '@/lib/types';
import { BookOpen, Clock, Award, Play, ArrowRight, Loader2, TrendingUp } from 'lucide-react';
import { CertificateCard } from '@/components/learner/CertificateCard';
import { toast } from '@/components/ui/sonner';

export default function LearnerDashboard() {
  const { user, currentOrg, profile, memberships } = useAuth();
  const { features } = usePlatformSettings();
  const { t } = useTranslation();
  const [enrollments, setEnrollments] = useState<(Enrollment & { course: Course })[]>([]);
  const [progressData, setProgressData] = useState<Record<string, { total: number; completed: number }>>({});
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user || !currentOrg) {
        if (!user) {
          // No authenticated user — nothing to load
          setLoading(false);
        } else if (profile) {
          // User context has resolved (profile is non-null) but no org is available
          // (e.g. no memberships, or platform admin with none selected) — done loading
          setLoading(false);
        }
        // else: user exists but profile not yet fetched — keep spinner
        return;
      }

      try {
        const data = await callApi<{
          enrollments: Array<Enrollment & { course: Course }>;
          progress: Record<string, { total: number; completed: number }>;
        }>('/api/learner-dashboard', { orgId: currentOrg.id });

        setEnrollments(data.enrollments as any);
        setProgressData(data.progress);

        // Resolve thumbnail signed URLs
        const thumbMap: Record<string, string> = {};
        await Promise.all(
          data.enrollments.map(async (e: any) => {
            if (e.course?.thumbnail_url) {
              const url = await getSignedLmsAssetUrl(e.course.thumbnail_url);
              if (url) thumbMap[e.course_id] = url;
            }
          })
        );
        setThumbnailUrls(thumbMap);
      } catch (error) {
        console.error('Error loading dashboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, currentOrg, profile]);

  const inProgressCourses = enrollments.filter(e => e.status === 'enrolled');
  const completedCourses = enrollments.filter(e => e.status === 'completed');
  const completedEnrollments = completedCourses;
  const totalProgress = enrollments.length > 0
    ? (completedCourses.length / enrollments.length) * 100
    : 0;

  const handleDownloadCertificate = async (enrollmentId: string, courseTitle: string) => {
    setDownloadingId(enrollmentId);

    try {
      const response = await callApiRaw('/api/generate-certificate', { enrollmentId });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `certificate-${courseTitle.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: t('certificates.downloadSuccess'),
        description: t('certificates.downloadSuccessDescription'),
      });
    } catch (_err) {
      toast({
        title: t('certificates.downloadFailed'),
        description: t('certificates.downloadFailedDescription'),
        variant: 'destructive',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <AppLayout title={t('dashboard.title')}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!currentOrg) {
    const isNoMembership = memberships.length === 0;
    return (
      <AppLayout title={t('dashboard.title')}>
        <div className="flex h-64 items-center justify-center">
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={isNoMembership ? t('dashboard.noMembershipTitle') : t('common.noOrgSelected')}
            description={isNoMembership ? t('dashboard.noMembershipDescription') : t('common.joinOrgToContinue')}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('dashboard.title')}>
      {/* Stats Grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('dashboard.coursesEnrolled')}
          value={enrollments.length}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          title={t('dashboard.inProgress')}
          value={inProgressCourses.length}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title={t('dashboard.completed')}
          value={completedCourses.length}
          icon={<Award className="h-5 w-5" />}
        />
        <StatCard
          title={t('dashboard.overallProgress')}
          value={`${Math.round(totalProgress)}%`}
          icon={
            totalProgress > 0
              ? <ProgressRing progress={totalProgress} size={24} strokeWidth={3} showLabel={false} />
              : <TrendingUp className="h-5 w-5" />
          }
        />
      </div>

      {/* Continue Learning */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{t('dashboard.continueLearning')}</h2>
          <Link to="/app/courses">
            <Button variant="ghost" size="sm">
              {t('dashboard.viewAllCourses')}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>

        {inProgressCourses.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={t('dashboard.noCoursesInProgress')}
            description={t('dashboard.startLearning')}
            action={
              <Link to="/app/courses">
                <Button>{t('dashboard.browseCourses')}</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inProgressCourses.slice(0, 3).map((enrollment) => {
              const progress = progressData[enrollment.course_id];
              const progressPercent = progress
                ? (progress.completed / progress.total) * 100
                : 0;

              return (
                <Card key={enrollment.id} className="overflow-hidden transition-shadow hover:shadow-card-hover">
                  <div className="aspect-video bg-gradient-to-br from-primary/80 to-primary relative overflow-hidden">
                    {thumbnailUrls[enrollment.course_id] && (
                      <img
                        src={thumbnailUrls[enrollment.course_id]}
                        alt={enrollment.course?.title || ''}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="font-display font-semibold leading-tight">
                        {enrollment.course?.title}
                      </h3>
                      <Badge variant="secondary" className="shrink-0">
                        {enrollment.course?.level}
                      </Badge>
                    </div>
                    <p className="mb-4 text-sm text-muted-foreground line-clamp-2">
                      {enrollment.course?.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ProgressRing progress={progressPercent} size={32} strokeWidth={4} />
                        <span className="text-xs text-muted-foreground">
                          {progress?.completed || 0}/{progress?.total || 0} {t('common.lessons')}
                        </span>
                      </div>
                      <Link to={`/app/learn/${enrollment.course_id}`}>
                        <Button size="sm">
                          <Play className="mr-1 h-3 w-3" />
                          {t('common.continue')}
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed Courses */}
      {completedCourses.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 font-display text-lg font-semibold">{t('dashboard.completedCourses')}</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {completedCourses.map((enrollment) => (
              <Card key={enrollment.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                    <Award className="h-6 w-6 text-success" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium">{enrollment.course?.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t('common.completedOn')} {new Date(enrollment.completed_at!).toLocaleDateString()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Certificates */}
      {features.certificates_enabled && (
        <div id="certificates">
          <h2 className="mb-4 font-display text-lg font-semibold">{t('certificates.title')}</h2>
          {completedEnrollments.length === 0 ? (
            <EmptyState
              icon={<Award className="h-6 w-6" />}
              title={t('certificates.noCertificates')}
              description={t('certificates.noCertificatesDescription')}
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {completedEnrollments.map((enrollment) => (
                <CertificateCard
                  key={enrollment.id}
                  enrollment={enrollment}
                  profile={profile}
                  downloading={downloadingId === enrollment.id}
                  onDownload={handleDownloadCertificate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
}
