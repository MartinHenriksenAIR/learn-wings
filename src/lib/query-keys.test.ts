import { describe, it, expect } from 'vitest';
import { queryKeys } from './query-keys';

// These tests assert that every factory method returns the EXACT array literal
// that the corresponding call site used before migration. Byte-for-byte identity
// matters because TanStack Query invalidation uses prefix matching.

describe('queryKeys', () => {
  // organizations
  it('organizations.all returns the root key', () => {
    expect(queryKeys.organizations.all).toEqual(['organizations']);
  });

  // community-categories
  it('communityCategories.all returns the root key', () => {
    expect(queryKeys.communityCategories.all).toEqual(['community-categories']);
  });

  // community-posts
  it('communityPosts.all returns the root key (prefix for invalidation)', () => {
    expect(queryKeys.communityPosts.all).toEqual(['community-posts']);
  });
  it('communityPosts.list returns the full parameterized key', () => {
    expect(
      queryKeys.communityPosts.list('org', 'org-1', 'cat-a', 'hello', ['t1', 't2']),
    ).toEqual(['community-posts', 'org', 'org-1', 'cat-a', 'hello', ['t1', 't2']]);
  });
  it('communityPosts.list with undefined orgId and undefined tags', () => {
    expect(
      queryKeys.communityPosts.list('global', undefined, '', '', []),
    ).toEqual(['community-posts', 'global', undefined, '', '', []]);
  });

  // community-post (single)
  it('communityPost.detail returns the parameterized key', () => {
    expect(queryKeys.communityPost.detail('post-123')).toEqual(['community-post', 'post-123']);
  });

  // community-comments
  it('communityComments.list returns the parameterized key', () => {
    expect(queryKeys.communityComments.list('post-123')).toEqual(['community-comments', 'post-123']);
  });

  // idea (single)
  it('idea.detail returns the parameterized key', () => {
    expect(queryKeys.idea.detail('idea-abc')).toEqual(['idea', 'idea-abc']);
  });

  // idea-comments
  it('ideaComments.list returns the parameterized key', () => {
    expect(queryKeys.ideaComments.list('idea-abc')).toEqual(['idea-comments', 'idea-abc']);
  });

  // ideas (list)
  it('ideas.all returns the root key (prefix for invalidation)', () => {
    expect(queryKeys.ideas.all).toEqual(['ideas']);
  });
  it('ideas.list returns the full parameterized key', () => {
    expect(
      queryKeys.ideas.list('org-1', 'all', 'search', 'finance', ['t1'], 'user-1'),
    ).toEqual(['ideas', 'org-1', 'all', 'search', 'finance', ['t1'], 'user-1']);
  });

  // idea-tags
  it('ideaTags.list returns the parameterized key', () => {
    expect(queryKeys.ideaTags.list('org-1')).toEqual(['idea-tags', 'org-1']);
  });

  // ideas-admin
  it('ideasAdmin.all returns the root key (prefix for invalidation)', () => {
    expect(queryKeys.ideasAdmin.all).toEqual(['ideas-admin']);
  });
  it('ideasAdmin.list returns the full parameterized key', () => {
    expect(
      queryKeys.ideasAdmin.list('org-1', 'search', 'finance'),
    ).toEqual(['ideas-admin', 'org-1', 'search', 'finance']);
  });

  // community-resources
  it('communityResources.all returns the root key (prefix for invalidation)', () => {
    expect(queryKeys.communityResources.all).toEqual(['community-resources']);
  });
  it('communityResources.list returns the full parameterized key', () => {
    expect(
      queryKeys.communityResources.list('org-1', 'search', 'link', 'tag1'),
    ).toEqual(['community-resources', 'org-1', 'search', 'link', 'tag1']);
  });

  // org-reports
  it('orgReports.all returns the root key (prefix for invalidation)', () => {
    expect(queryKeys.orgReports.all).toEqual(['org-reports']);
  });
  it('orgReports.list returns the full parameterized key', () => {
    expect(queryKeys.orgReports.list('org-1', 'pending')).toEqual(['org-reports', 'org-1', 'pending']);
  });

  // platform-reports
  it('platformReports.all returns the root key (prefix for invalidation)', () => {
    expect(queryKeys.platformReports.all).toEqual(['platform-reports']);
  });
  it('platformReports.list returns the full parameterized key', () => {
    expect(queryKeys.platformReports.list('pending')).toEqual(['platform-reports', 'pending']);
  });

  // ai-champions
  it('aiChampions.list returns the parameterized key', () => {
    expect(queryKeys.aiChampions.list('org-1')).toEqual(['ai-champions', 'org-1']);
  });

  // courses-admin
  it('coursesAdmin.all returns the root key', () => {
    expect(queryKeys.coursesAdmin.all).toEqual(['courses-admin']);
  });

  // course-structure-admin
  it('courseStructureAdmin.detail returns the parameterized key', () => {
    expect(queryKeys.courseStructureAdmin.detail('course-1')).toEqual(['course-structure-admin', 'course-1']);
  });

  // quiz-admin
  it('quizAdmin.detail returns the parameterized key', () => {
    expect(queryKeys.quizAdmin.detail('lesson-1')).toEqual(['quiz-admin', 'lesson-1']);
  });

  // platform-settings
  it('platformSettings.all returns the root key', () => {
    expect(queryKeys.platformSettings.all).toEqual(['platform-settings']);
  });

  // profiles
  it('profiles.all returns the root key (prefix for invalidation)', () => {
    expect(queryKeys.profiles.all).toEqual(['profiles']);
  });

  // org-memberships
  it('orgMemberships.list returns the parameterized key', () => {
    expect(queryKeys.orgMemberships.list('org-1')).toEqual(['org-memberships', 'org-1']);
  });
  it('orgMemberships.list with undefined orgId', () => {
    expect(queryKeys.orgMemberships.list(undefined)).toEqual(['org-memberships', undefined]);
  });

  // invitations
  it('invitations.list returns the parameterized key for platform scope', () => {
    expect(queryKeys.invitations.list('org-1', 'platform')).toEqual(['invitations', 'org-1', 'platform']);
  });
  it('invitations.list returns the parameterized key for org scope', () => {
    expect(queryKeys.invitations.list('org-1', 'org')).toEqual(['invitations', 'org-1', 'org']);
  });
  it('invitations.list with undefined orgId', () => {
    expect(queryKeys.invitations.list(undefined, 'platform')).toEqual(['invitations', undefined, 'platform']);
  });

  // org-detail
  it('orgDetail.detail returns the parameterized key', () => {
    expect(queryKeys.orgDetail.detail('org-1')).toEqual(['org-detail', 'org-1']);
  });
  it('orgDetail.detail with undefined orgId', () => {
    expect(queryKeys.orgDetail.detail(undefined)).toEqual(['org-detail', undefined]);
  });
});
