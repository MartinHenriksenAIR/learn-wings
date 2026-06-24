import { describe, it, expect } from 'vitest';
import { buildReportContentLink } from './community-report-link';

describe('buildReportContentLink (#86)', () => {
  it('post report links straight to the post', () => {
    expect(
      buildReportContentLink({ target_type: 'post', target_id: 'post-1', post_id: null }, 'org'),
    ).toBe('/app/community/org/posts/post-1');
  });

  it('post report respects global scope', () => {
    expect(
      buildReportContentLink({ target_type: 'post', target_id: 'post-1' }, 'global'),
    ).toBe('/app/community/global/posts/post-1');
  });

  it('comment report links to the parent post with a #comment- anchor', () => {
    expect(
      buildReportContentLink(
        { target_type: 'comment', target_id: 'comment-7', post_id: 'post-1' },
        'org',
      ),
    ).toBe('/app/community/org/posts/post-1#comment-comment-7');
  });

  it('comment report in global scope links to the parent post with anchor', () => {
    expect(
      buildReportContentLink(
        { target_type: 'comment', target_id: 'comment-7', post_id: 'post-1' },
        'global',
      ),
    ).toBe('/app/community/global/posts/post-1#comment-comment-7');
  });

  it('comment report with a missing parent post id returns null (orphaned — no broken link)', () => {
    expect(
      buildReportContentLink({ target_type: 'comment', target_id: 'comment-7', post_id: null }, 'org'),
    ).toBeNull();
    expect(
      buildReportContentLink({ target_type: 'comment', target_id: 'comment-7' }, 'org'),
    ).toBeNull();
  });
});
