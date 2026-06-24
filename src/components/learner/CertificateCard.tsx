import { Button } from '@/components/ui/button';
import { Award, Check, Download, Loader2 } from 'lucide-react';
import { Enrollment, Course, Profile } from '@/lib/types';
import { useTranslation } from 'react-i18next';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { cn } from '@/lib/utils';

interface CertificateCardProps {
  enrollment: Enrollment & { course: Course };
  profile: Profile | null;
  downloading: boolean;
  /** Transient post-download success state (drives the in-button "Saved" morph). */
  saved: boolean;
  onDownload: (enrollmentId: string, courseTitle: string) => void;
}

export function CertificateCard({ enrollment, profile, downloading, saved, onDownload }: CertificateCardProps) {
  const { t } = useTranslation();
  const { branding } = usePlatformSettings();
  const completedOn = new Date(enrollment.completed_at!).toLocaleDateString();

  return (
    <div className="hover-lift group relative flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
      {/* Hover preview popover: a miniature of the certificate, revealed on hover.
          Decorative duplicate of the card's info, so hidden from assistive tech. */}
      <div
        aria-hidden="true"
        data-testid="certificate-preview"
        className="pointer-events-none absolute bottom-[calc(100%+12px)] left-1/2 z-40 w-[300px] -translate-x-1/2 translate-y-2 rounded-[14px] border border-[#e4e6ee] bg-card p-2.5 opacity-0 shadow-[0_24px_60px_rgba(20,24,46,0.20)] transition-[opacity,transform] duration-[250ms] group-hover:translate-y-0 group-hover:opacity-100"
      >
        <div className="rounded-[9px] border-2 border-primary px-4 py-[18px] text-center [background:linear-gradient(180deg,#fdfdfe,#f4f6fc)]">
          <span className="mb-2 inline-grid h-[34px] w-[34px] place-items-center rounded-full bg-primary text-primary-foreground">
            <Award className="h-4 w-4" />
          </span>
          <span className="mb-1.5 block text-[9.5px] font-extrabold uppercase tracking-[0.18em] text-primary">
            {t('certificates.certificateOfCompletion')}
          </span>
          <span className="mb-0.5 block text-[15px] font-extrabold">{profile?.full_name}</span>
          <span className="mb-2 block text-[11px] text-muted-foreground">
            {t('certificates.hasSuccessfullyCompleted')}
          </span>
          <span className="mb-2 block text-xs font-bold">{enrollment.course?.title}</span>
          <span className="block text-[10px] text-[#9aa0af]">
            {branding.platform_name} · {completedOn}
          </span>
        </div>
      </div>

      <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] bg-[linear-gradient(135deg,#10298f,#2a4fd0)] text-white">
        <Award className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-bold">{enrollment.course?.title}</span>
        <span className="text-xs text-[#9aa0af]">
          {t('certificates.issuedTo', { name: profile?.full_name, date: completedOn })}
        </span>
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onDownload(enrollment.id, enrollment.course?.title || 'course')}
        disabled={downloading}
        className={cn(
          'rounded-[10px] text-[12.5px] font-bold',
          saved && 'border-[#bfe5d3] text-success hover:bg-success/10 hover:text-success'
        )}
      >
        {downloading ? (
          <Loader2 className="animate-spin" />
        ) : saved ? (
          <Check aria-hidden="true" />
        ) : (
          <Download aria-hidden="true" />
        )}
        {saved ? t('common.saved') : t('common.download')}
      </Button>
    </div>
  );
}
