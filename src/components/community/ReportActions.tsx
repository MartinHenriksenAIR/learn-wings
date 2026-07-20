import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { canViewReportedContent } from '@/lib/community-report-link';
import type { CommunityReport } from '@/lib/community-types';
import { Eye, EyeOff, Lock, Unlock, CheckCircle, XCircle } from 'lucide-react';

/** The report fields the moderation action bar needs. Both moderation pages
 *  pass a superset (ReportWithDetails), so a Pick keeps the contract minimal. */
export type ReportActionsReport = Pick<
  CommunityReport,
  'id' | 'target_type' | 'target_id' | 'status' | 'post_id' | 'target_is_hidden' | 'target_is_locked'
>;

export interface ReportActionsProps {
  report: ReportActionsReport;
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
 * Per-report moderation action bar, shared by the platform + org moderation
 * views (#169). Lock/hide are single toggles reflecting the target's current
 * state (target_is_locked / target_is_hidden from community-reports); a null
 * state means the target was deleted, so its toggle is disabled.
 */
export function ReportActions({
  report,
  onViewContent,
  onSetHidden,
  onSetLocked,
  onDismiss,
  onReview,
  visibilityPending,
  lockPending,
  updatePending,
}: ReportActionsProps) {
  const { t } = useTranslation();
  const isPost = report.target_type === 'post';
  const isHidden = !!report.target_is_hidden;
  const isLocked = !!report.target_is_locked;
  const hideDisabled = visibilityPending || report.target_is_hidden == null;
  const lockDisabled = lockPending || report.target_is_locked == null;

  const hideLabel = isPost
    ? (isHidden ? t('moderation.showPost') : t('moderation.hidePost'))
    : (isHidden ? t('moderation.showComment') : t('moderation.hideComment'));

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onViewContent}
            disabled={!canViewReportedContent(report)}
          >
            <Eye className="h-3.5 w-3.5" />
            {t('moderation.viewContent')}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('moderation.viewContent')}</TooltipContent>
      </Tooltip>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onSetHidden(!isHidden)}
        disabled={hideDisabled}
      >
        {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        {hideLabel}
      </Button>

      {isPost && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSetLocked(!isLocked)}
          disabled={lockDisabled}
        >
          {isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {isLocked ? t('moderation.unlockPost') : t('moderation.lockPost')}
        </Button>
      )}

      {report.status === 'pending' && (
        <>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={onDismiss} disabled={updatePending}>
            <XCircle className="h-3.5 w-3.5" />
            {t('moderation.dismiss')}
          </Button>
          <Button size="sm" onClick={onReview} disabled={updatePending}>
            <CheckCircle className="h-3.5 w-3.5" />
            {t('moderation.markReviewed')}
          </Button>
        </>
      )}
    </div>
  );
}
