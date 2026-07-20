import { describe, it, expect } from 'vitest';
import { canViewReportedContent } from './community-report-link';

describe('canViewReportedContent (#86, #160)', () => {
  it('post reports are always viewable', () => {
    expect(canViewReportedContent({ target_type: 'post', post_id: null })).toBe(true);
    expect(canViewReportedContent({ target_type: 'post' })).toBe(true);
  });

  it('comment reports with a known parent post are viewable', () => {
    expect(canViewReportedContent({ target_type: 'comment', post_id: 'post-1' })).toBe(true);
  });

  it('orphaned comment reports (missing parent post id) are not viewable', () => {
    expect(canViewReportedContent({ target_type: 'comment', post_id: null })).toBe(false);
    expect(canViewReportedContent({ target_type: 'comment' })).toBe(false);
  });
});
