import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  updateReport,
  togglePostHidden,
  toggleCommentHidden,
  togglePostLocked,
} from '@/lib/community-api';
import type { CommunityReport } from '@/lib/community-types';

/**
 * The moderation view-model both queues render: a community report plus the
 * minimal reporter projection the endpoints join out (`{ id, full_name }`),
 * which is narrower than the full `Profile` on `CommunityReport.reporter`.
 * Owned here because the hook and both moderation pages share it (#237).
 */
export interface ReportWithDetails extends Omit<CommunityReport, 'reporter'> {
  reporter?: { id: string; full_name: string };
}

/**
 * The three report-moderation mutations shared by the org + platform community
 * moderation queues (#237). They were byte-identical across both pages apart
 * from which report-list query family they invalidate, so the family to
 * invalidate is the hook's one parameter.
 *
 * Moderation decisions keep their success/failure toasts (toast policy);
 * success also invalidates the passed queue prefix so the list refreshes.
 * Dialog state (open/close, admin notes) stays at the call site — see
 * ReviewReportDialog — because `updateReport` is triggered from two places
 * (the per-card dismiss button and the review dialog) that manage it differently.
 *
 * @param invalidateKey the report-list family's `all` prefix
 *   (`queryKeys.orgReports.all` or `queryKeys.platformReports.all`).
 * @param onUpdateSuccess extra work after a status update succeeds — the
 *   review dialog uses it to close itself and clear its selection.
 */
export function useReportModeration(
  invalidateKey: readonly unknown[],
  onUpdateSuccess?: () => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Update report status — moderation decisions keep their toasts (toast policy).
  const updateReportMutation = useMutation({
    mutationFn: async ({
      reportId,
      status,
      notes,
    }: {
      reportId: string;
      status: 'reviewed' | 'dismissed';
      notes?: string;
    }) => {
      await updateReport(reportId, { status, admin_notes: notes || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invalidateKey });
      onUpdateSuccess?.();
      toast.success(t('moderation.reportUpdated'));
    },
    onError: () => {
      toast.error(t('moderation.reportUpdateFailed'));
    },
  });

  // Hide/show content — moderation decisions keep their toasts (toast policy).
  const toggleContentVisibility = useMutation({
    mutationFn: async ({
      type,
      id,
      hide,
    }: {
      type: 'post' | 'comment';
      id: string;
      hide: boolean;
    }) => {
      if (type === 'post') {
        await togglePostHidden(id, hide);
      } else {
        await toggleCommentHidden(id, hide);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invalidateKey });
      toast.success(t('moderation.visibilityUpdated'));
    },
    onError: () => {
      toast.error(t('moderation.contentUpdateFailed'));
    },
  });

  // Lock/unlock post comments — moderation decisions keep their toasts (toast policy).
  const togglePostLock = useMutation({
    mutationFn: async ({ postId, lock }: { postId: string; lock: boolean }) => {
      await togglePostLocked(postId, lock);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invalidateKey });
      toast.success(t('moderation.lockUpdated'));
    },
    onError: () => {
      toast.error(t('moderation.postUpdateFailed'));
    },
  });

  return { updateReportMutation, toggleContentVisibility, togglePostLock };
}
