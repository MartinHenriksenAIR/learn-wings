import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { ReportActions } from '@/components/community/ReportActions';
import type { ReportWithDetails } from '@/hooks/useReportModeration';
import { cn } from '@/lib/utils';
import { formatDistanceToNowLocalized } from '@/lib/date-locale';
import { MessageSquare, FileText } from 'lucide-react';

export interface ReportCardProps {
  report: ReportWithDetails;
  /**
   * Optional scope badge rendered in the meta row after the status badge. The
   * platform queue spans every org + global so it shows where a report came
   * from; the org queue is single-scope and passes nothing (#237).
   */
  scopeBadge?: ReactNode;
  onViewContent: () => void;
  onSetHidden: (hide: boolean) => void;
  onSetLocked: (lock: boolean) => void;
  onDismiss: () => void;
  onReview: () => void;
  visibilityPending: boolean;
  lockPending: boolean;
  updatePending: boolean;
}

/**
 * One report row shared by the org + platform community moderation queues
 * (#237): the meta row (type icon/badge, status, optional scope badge, reporter
 * line), the report reason, any admin note, and the shared ReportActions bar.
 * View-only presentation — all actions are delegated to the caller, which owns
 * the mutations (useReportModeration) and dialog state.
 */
export function ReportCard({
  report,
  scopeBadge,
  onViewContent,
  onSetHidden,
  onSetLocked,
  onDismiss,
  onReview,
  visibilityPending,
  lockPending,
  updatePending,
}: ReportCardProps) {
  const { t, i18n } = useTranslation();
  const isPost = report.target_type === 'post';

  return (
    <Card>
      <CardContent className="px-[22px] py-[18px]">
        {/* Meta row */}
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#fdecec] text-[#c43d3d]">
            {isPost ? <FileText className="h-[15px] w-[15px]" /> : <MessageSquare className="h-[15px] w-[15px]" />}
          </span>
          <span className="rounded-[7px] bg-[#f3f4f8] px-[11px] py-1 text-[11px] font-bold text-muted-foreground">
            {isPost ? t('moderation.typePost') : t('moderation.typeComment')}
          </span>
          <span
            className={cn(
              'rounded-[7px] px-[11px] py-1 text-[11px] font-bold capitalize',
              report.status === 'pending'
                ? 'bg-[#fdecec] text-[#c43d3d]'
                : 'bg-[#f3f4f8] text-muted-foreground'
            )}
          >
            {report.status}
          </span>
          {scopeBadge}
          <div className="flex-1" />
          <span className="text-[11.5px] font-semibold text-muted-foreground">
            {t('moderation.reportedBy', {
              name: report.reporter?.full_name || t('moderation.unknownReporter'),
              time: formatDistanceToNowLocalized(new Date(report.created_at), i18n.language),
            })}
          </span>
        </div>

        {/* Reason */}
        <p className="mb-1 text-[13.5px] font-bold">{t('moderation.reasonLabel')}</p>
        <p className="mb-3.5 text-[13px] italic leading-[1.5] text-muted-foreground">
          {report.reason}
        </p>

        {report.admin_notes && (
          <p className="mb-3.5 rounded-[10px] bg-[#fbf2dd] px-3.5 py-2.5 text-[12.5px] text-[#8a5e10]">
            <strong>{t('moderation.adminNotesInline')}</strong> {report.admin_notes}
          </p>
        )}

        <ReportActions
          report={report}
          onViewContent={onViewContent}
          onSetHidden={onSetHidden}
          onSetLocked={onSetLocked}
          onDismiss={onDismiss}
          onReview={onReview}
          visibilityPending={visibilityPending}
          lockPending={lockPending}
          updatePending={updatePending}
        />
      </CardContent>
    </Card>
  );
}
