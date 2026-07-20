import type { CommunityReport } from '@/lib/community-types';

/**
 * Whether a community report's target can be shown in the moderation
 * "View content" dialog (#160, preserving the #86 orphan rule).
 *
 * - post targets    → always viewable (the target id IS the post id)
 * - comment targets → viewable only when the parent post id is known;
 *   an orphaned comment report (comment deleted → post_id missing) has no
 *   post to open, so callers keep the button disabled.
 */
export function canViewReportedContent(
  report: Pick<CommunityReport, 'target_type' | 'post_id'>,
): boolean {
  if (report.target_type === 'comment') {
    return !!report.post_id;
  }
  return true;
}
