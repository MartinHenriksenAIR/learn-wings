import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Award, Download, Loader2 } from 'lucide-react';
import { Enrollment, Course, Profile } from '@/lib/types';
import { useTranslation } from 'react-i18next';

interface CertificateCardProps {
  enrollment: Enrollment & { course: Course };
  profile: Profile | null;
  downloading: boolean;
  onDownload: (enrollmentId: string, courseTitle: string) => void;
}

export function CertificateCard({ enrollment, profile, downloading, onDownload }: CertificateCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-primary via-primary/90 to-accent/40 p-6 text-primary-foreground">
        <div className="mb-4 flex items-center gap-2">
          <Award className="h-8 w-8" />
          <span className="text-sm font-medium uppercase tracking-wider opacity-80">
            {t('certificates.certificateOfCompletion')}
          </span>
        </div>
        <h3 className="mb-2 font-display text-xl font-bold">
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
            onClick={() => onDownload(enrollment.id, enrollment.course?.title || 'course')}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {t('common.download')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
