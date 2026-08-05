/**
 * Single owner for every TanStack Query key shape in the frontend.
 *
 * TkDodo-style hierarchical factory: each family exposes an `all` constant
 * (a tuple used as the invalidation prefix) and typed factory methods for the
 * parameterized forms. Invalidation still works because TanStack Query matches
 * by prefix — invalidating `['ideas']` hits `['ideas', orgId, tab, ...]`.
 *
 * Keys must stay byte-for-byte identical to the literals they replace; do NOT
 * change string literals or parameter order here without updating every call
 * site and the test file in the same commit.
 *
 * Adding a family: give it an `all` prefix constant ONLY if something
 * invalidates it by prefix — a detail-only family with an unused `all` is
 * dead surface. Match each method's parameter nullability to what its call
 * site actually passes (e.g. `string | undefined` for `currentOrg?.id`).
 */
export const queryKeys = {
  organizations: {
    all: ['organizations'] as const,
  },

  brandingAsset: {
    /** One signed-URL cache entry per stored path. */
    signed: (blobPath: string) => ['branding-asset', blobPath] as const,
  },

  communityCategories: {
    all: ['community-categories'] as const,
  },

  communityPosts: {
    all: ['community-posts'] as const,
    list: (
      scope: string,
      orgId: string | undefined,
      selectedCategory: string,
      searchQuery: string,
      selectedTags: string[],
    ) =>
      ['community-posts', scope, orgId, selectedCategory, searchQuery, selectedTags] as const,
  },

  communityPost: {
    detail: (postId: string | undefined) => ['community-post', postId] as const,
  },

  communityComments: {
    list: (postId: string | undefined) => ['community-comments', postId] as const,
  },

  idea: {
    detail: (ideaId: string | undefined) => ['idea', ideaId] as const,
  },

  ideaComments: {
    list: (ideaId: string | undefined) => ['idea-comments', ideaId] as const,
  },

  ideas: {
    all: ['ideas'] as const,
    list: (
      orgId: string | undefined,
      tab: string,
      searchQuery: string,
      selectedBusinessArea: string,
      selectedTags: string[],
      profileId: string | undefined,
    ) =>
      [
        'ideas',
        orgId,
        tab,
        searchQuery,
        selectedBusinessArea,
        selectedTags,
        profileId,
      ] as const,
  },

  ideaTags: {
    list: (orgId: string | undefined) => ['idea-tags', orgId] as const,
  },

  ideasAdmin: {
    all: ['ideas-admin'] as const,
    list: (
      orgId: string | undefined,
      searchQuery: string,
      selectedBusinessArea: string,
    ) => ['ideas-admin', orgId, searchQuery, selectedBusinessArea] as const,
  },

  communityResources: {
    all: ['community-resources'] as const,
    list: (
      orgId: string | undefined,
      debouncedSearch: string,
      selectedType: string,
      selectedTag: string,
    ) =>
      ['community-resources', orgId, debouncedSearch, selectedType, selectedTag] as const,
  },

  orgReports: {
    all: ['org-reports'] as const,
    list: (orgId: string | undefined, activeTab: string) =>
      ['org-reports', orgId, activeTab] as const,
  },

  platformReports: {
    all: ['platform-reports'] as const,
    /**
     * scope is 'all' | 'global' | <orgId>; different scopes must not share a
     * cache entry because the server-side auth path differs per scope.
     */
    list: (scope: string, activeTab: string) =>
      ['platform-reports', scope, activeTab] as const,
  },

  aiChampions: {
    list: (orgId: string | undefined) => ['ai-champions', orgId] as const,
  },

  profiles: {
    /**
     * The platform-admin grant/revoke mutations invalidate this by prefix so the
     * derived current-admins and grant-candidate lists both refresh (#198). Kept
     * as `all` for shape-consistency with the other list families.
     */
    all: ['profiles'] as const,
  },

  orgMemberships: {
    /**
     * No `all` prefix — nothing invalidates by prefix (each mutation targets a
     * specific orgId and can invalidate the exact key).
     */
    list: (orgId: string | undefined) => ['org-memberships', orgId] as const,
  },

  invitations: {
    /**
     * scope: 'platform' (OrganizationDetail) | 'org' (OrgMembersTab). The scope
     * encodes the server-side auth path, so different scopes must not share a cache
     * entry. No `all` prefix — mutations invalidate the exact (orgId, scope) pair.
     */
    list: (orgId: string | undefined, scope: string) =>
      ['invitations', orgId, scope] as const,
  },

  orgDetail: {
    /**
     * Separate from `organizations.all` because the request body differs (passes
     * `{ orgId }` to `/api/organizations` for a single-org fetch).
     */
    detail: (orgId: string | undefined) => ['org-detail', orgId] as const,
  },

  platformSettings: {
    /**
     * No mutation currently invalidates this — saves write partial updates
     * client-side and rely on local form state. Kept as `all` for shape-consistency.
     */
    all: ['platform-settings'] as const,
  },

  orgAnalyticsData: {
    detail: (orgId: string | undefined) => ['org-analytics-data', orgId] as const,
  },

  orgCourseProgress: {
    /**
     * adminLang is in the key because the representative edition's title/level shown
     * per group depends on the admin's app language (#213).
     */
    detail: (orgId: string | undefined, adminLang: string | undefined) =>
      ['org-course-progress', orgId, adminLang] as const,
  },

  orgCourseEnrollees: {
    detail: (orgId: string | undefined, courseId: string | undefined) =>
      ['org-course-enrollees', orgId, courseId] as const,
  },

  orgCourseOrgBreakdown: {
    /**
     * Keyed by courseId only — the endpoint is platform-admin, cross-org by
     * construction (#163).
     */
    detail: (courseId: string | undefined) =>
      ['org-course-org-breakdown', courseId] as const,
  },

  userProgress: {
    detail: (orgId: string | undefined, userId: string | undefined) =>
      ['user-progress', orgId, userId] as const,
  },

  coursesAdmin: {
    /** The admin course list + access matrix (one query, no params). */
    all: ['courses-admin'] as const,
  },

  courseStructureAdmin: {
    detail: (courseId: string) => ['course-structure-admin', courseId] as const,
  },

  quizAdmin: {
    detail: (lessonId: string) => ['quiz-admin', lessonId] as const,
  },

  exerciseAdmin: {
    detail: (lessonId: string) => ['exercise-admin', lessonId] as const,
  },

  exerciseByLesson: {
    detail: (lessonId: string | undefined) => ['exercise-by-lesson', lessonId] as const,
  },

  learnerCourses: {
    /** Exposed as `list` because enroll/unenroll mutations invalidate by this key. */
    list: (orgId: string | undefined) => ['learner-courses', orgId] as const,
  },

  learnerDashboard: {
    detail: (orgId: string | undefined) => ['learner-dashboard', orgId] as const,
  },

  favorites: {
    /** Exposed as `list` because the toggle mutation invalidates by this key. */
    list: (orgId: string | undefined) => ['favorites', orgId] as const,
  },

  assessment: {
    /** No params; fixed content with a long staleTime. */
    questions: ['assessment-questions'] as const,
  },

  seatPricing: {
    all: ['seat-pricing'] as const,
  },

  seatRequests: {
    all: ['seat-requests'] as const,
    list: (orgId: string | undefined) => ['seat-requests', orgId] as const,
  },
} as const;
