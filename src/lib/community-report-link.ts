import type { CommunityReport } from '@/lib/community-types';

/**
 * Builds the "View content" deep-link for a community report (#86).
 *
 * - post targets    → /app/community/<scope>/posts/<target_id>
 * - comment targets → /app/community/<scope>/posts/<post_id>#comment-<target_id>
 *   (PostDetail scrolls to and highlights the #comment- anchor)
 * - comment targets whose parent post id is missing (orphaned report — the
 *   comment was deleted) → null; callers disable the link instead of linking
 *   a broken /posts/<commentUuid>.
 */
export function buildReportContentLink(
  report: Pick<CommunityReport, 'target_type' | 'target_id' | 'post_id'>,
  scope: 'org' | 'global',
): string | null {
  const base = `/app/community/${scope}/posts`;
  if (report.target_type === 'comment') {
    if (!report.post_id) return null;
    return `${base}/${report.post_id}#comment-${report.target_id}`;
  }
  return `${base}/${report.target_id}`;
}
