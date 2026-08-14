import type { CommunityReport } from '@/lib/community-types';

export function canViewReportedContent(
  report: Pick<CommunityReport, 'target_type' | 'post_id'>,
): boolean {
  if (report.target_type === 'comment') {
    return !!report.post_id;
  }
  return true;
}
