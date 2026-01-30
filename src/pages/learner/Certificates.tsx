import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { supabase } from '@/integrations/supabase/client';
import { Enrollment, Course } from '@/lib/types';
import { Award, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

export default function Certificates() {
  const { user, currentOrg, profile } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [completedEnrollments, setCompletedEnrollments] = useState<(Enrollment & { course: Course })[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!user || !currentOrg) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('enrollments')
        .select('*, course:courses(*)')
        .eq('user_id', user.id)
        .eq('org_id', currentOrg.id)
        .eq('status', 'completed');

      if (data) {
        setCompletedEnrollments(data as any);
      }
      setLoading(false);
    };

    fetchData();
  }, [user, currentOrg]);

  const handleDownloadCertificate = async (enrollmentId: string, courseTitle: string) => {
    setDownloadingId(enrollmentId);
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-certificate', {
        body: { enrollmentId },
      });

      if (error) {
        console.error('Error generating certificate:', error);
        toast({
          title: t('certificates.generateFailed'),
          description: error.message || t('certificates.generateFailedDescription'),
          variant: 'destructive',
        });
        return;
      }

      // Create blob from response and trigger download
      const blob = new Blob([data], { type: 'application/pdf' });
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
    } catch (err) {
      console.error('Error downloading certificate:', err);
      toast({
        title: t('certificates.downloadFailed'),
        description: t('certificates.downloadFailedDescription'),
        variant: 'destructive',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  // Redirect if certificates are disabled
  if (!settingsLoading && !features.certificates_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (loading || settingsLoading) {
    return (
      <AppLayout title={t('certificates.title')} breadcrumbs={[{ label: t('nav.certificates') }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout title={t('certificates.title')} breadcrumbs={[{ label: t('nav.certificates') }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Award className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">{t('common.noOrgSelected')}</p>
          <p className="text-sm text-muted-foreground">{t('certificates.joinOrgToEarn')}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('certificates.title')} breadcrumbs={[{ label: t('nav.certificates') }]}>
      {completedEnrollments.length === 0 ? (
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title={t('certificates.noCertificates')}
          description={t('certificates.noCertificatesDescription')}
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {completedEnrollments.map((enrollment) => (
            <Card key={enrollment.id} className="overflow-hidden">
              <div className="bg-gradient-to-br from-primary via-primary/90 to-accent/40 p-6 text-primary-foreground">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="h-8 w-8" />
                  <span className="text-sm font-medium uppercase tracking-wider opacity-80">
                    {t('certificates.certificateOfCompletion')}
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold mb-2">
                  {enrollment.course?.title}
                </h3>
                <p className="text-sm opacity-80">
                  {t('certificates.awardedTo', { name: profile?.full_name })}
                </p>
              </div>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {t('common.completedOn')} {new Date(enrollment.completed_at!).toLocaleDateString()}
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleDownloadCertificate(enrollment.id, enrollment.course?.title || 'course')}
                    disabled={downloadingId === enrollment.id}
                  >
                    {downloadingId === enrollment.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    {t('common.download')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
