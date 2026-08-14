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

export interface ReportWithDetails extends Omit<CommunityReport, 'reporter'> {
  reporter?: { id: string; full_name: string };
}

export function useReportModeration(
  invalidateKey: readonly unknown[],
  onUpdateSuccess?: () => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

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
