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
  // ── Organizations ──────────────────────────────────────────────────────────
  organizations: {
    /** ['organizations'] */
    all: ['organizations'] as const,
  },

  // ── Branding assets (signed display URLs) ────────────────────────────────────
  brandingAsset: {
    /** ['branding-asset', blobPath] — one signed-URL cache entry per stored path. */
    signed: (blobPath: string) => ['branding-asset', blobPath] as const,
  },

  // ── Community feed ─────────────────────────────────────────────────────────
  communityCategories: {
    /** ['community-categories'] */
    all: ['community-categories'] as const,
  },

  communityPosts: {
    /** ['community-posts'] — use for invalidation prefix */
    all: ['community-posts'] as const,
    /**
     * Full key: ['community-posts', scope, orgId, selectedCategory, searchQuery, selectedTags]
     * Parameter order matches the query in CommunityFeed.tsx.
     */
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
    /**
     * Full key: ['community-post', postId]
     * Used by PostDetail.tsx and PostEdit.tsx.
     */
    detail: (postId: string | undefined) => ['community-post', postId] as const,
  },

  communityComments: {
    /**
     * Full key: ['community-comments', postId]
     * Used by PostDetail.tsx.
     */
    list: (postId: string | undefined) => ['community-comments', postId] as const,
  },

  // ── Ideas ──────────────────────────────────────────────────────────────────
  idea: {
    /**
     * Full key: ['idea', ideaId]
     * Used by IdeaDetail.tsx and IdeaSubmit.tsx.
     */
    detail: (ideaId: string | undefined) => ['idea', ideaId] as const,
  },

  ideaComments: {
    /**
     * Full key: ['idea-comments', ideaId]
     * Used by IdeaDetail.tsx.
     */
    list: (ideaId: string | undefined) => ['idea-comments', ideaId] as const,
  },

  ideas: {
    /** ['ideas'] — use for invalidation prefix */
    all: ['ideas'] as const,
    /**
     * Full key: ['ideas', orgId, tab, searchQuery, selectedBusinessArea, selectedTags, profileId]
     * Parameter order matches the query in IdeaLibrary.tsx.
     */
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
    /**
     * Full key: ['idea-tags', orgId]
     * Used by IdeaLibrary.tsx and IdeaSubmit.tsx.
     */
    list: (orgId: string | undefined) => ['idea-tags', orgId] as const,
  },

  ideasAdmin: {
    /** ['ideas-admin'] — use for invalidation prefix */
    all: ['ideas-admin'] as const,
    /**
     * Full key: ['ideas-admin', orgId, searchQuery, selectedBusinessArea]
     * Parameter order matches the query in OrgIdeasManagement.tsx.
     */
    list: (
      orgId: string | undefined,
      searchQuery: string,
      selectedBusinessArea: string,
    ) => ['ideas-admin', orgId, searchQuery, selectedBusinessArea] as const,
  },

  // ── Resources ──────────────────────────────────────────────────────────────
  communityResources: {
    /** ['community-resources'] — use for invalidation prefix */
    all: ['community-resources'] as const,
    /**
     * Full key: ['community-resources', orgId, debouncedSearch, selectedType, selectedTag]
     * Parameter order matches the query in ResourceLibrary.tsx.
     */
    list: (
      orgId: string | undefined,
      debouncedSearch: string,
      selectedType: string,
      selectedTag: string,
    ) =>
      ['community-resources', orgId, debouncedSearch, selectedType, selectedTag] as const,
  },

  // ── Moderation ─────────────────────────────────────────────────────────────
  orgReports: {
    /** ['org-reports'] — use for invalidation prefix */
    all: ['org-reports'] as const,
    /**
     * Full key: ['org-reports', orgId, activeTab]
     * Parameter order matches the query in OrgCommunityModeration.tsx.
     */
    list: (orgId: string | undefined, activeTab: string) =>
      ['org-reports', orgId, activeTab] as const,
  },

  platformReports: {
    /** ['platform-reports'] — use for invalidation prefix */
    all: ['platform-reports'] as const,
    /**
     * Full key: ['platform-reports', activeTab]
     * Parameter order matches the query in PlatformCommunityModeration.tsx.
     */
    list: (activeTab: string) => ['platform-reports', activeTab] as const,
  },

  // ── AI Champions ───────────────────────────────────────────────────────────
  aiChampions: {
    /**
     * Full key: ['ai-champions', orgId]
     * Used by AIChampionsList.tsx.
     */
    list: (orgId: string | undefined) => ['ai-champions', orgId] as const,
  },

  // ── Org management (platform-admin) ────────────────────────────────────────

  profiles: {
    /**
     * ['profiles'] — the platform-wide user list fetched by OrganizationsManager
     * and OrganizationDetail. This IS the query key (the list takes no params),
     * not merely an invalidation prefix: no mutation currently invalidates it,
     * because adding an existing profile to an org does not change the profile
     * list. Kept as `all` for shape-consistency with the other list families.
     */
    all: ['profiles'] as const,
  },

  orgMemberships: {
    /**
     * Full key: ['org-memberships', orgId]
     * Used by OrganizationDetail.tsx and OrgMembersTab.tsx.
     * `all` is NOT exposed — nothing invalidates by prefix (each mutation
     * targets a specific orgId and can invalidate the exact key).
     */
    list: (orgId: string | undefined) => ['org-memberships', orgId] as const,
  },

  invitations: {
    /**
     * Full key: ['invitations', orgId, scope]
     * scope: 'platform' (OrganizationDetail) | 'org' (OrgMembersTab).
     * The scope encodes the server-side auth path, so different scopes must
     * not share a cache entry. No `all` prefix — mutations invalidate the
     * exact (orgId, scope) pair.
     */
    list: (orgId: string | undefined, scope: string) =>
      ['invitations', orgId, scope] as const,
  },

  orgDetail: {
    /**
     * Full key: ['org-detail', orgId]
     * Used by OrganizationDetail.tsx (platform-admin, fetches single org via
     * `/api/organizations` with `{ orgId }`). Separate from
     * `organizations.all` because the request body differs.
     */
    detail: (orgId: string | undefined) => ['org-detail', orgId] as const,
  },

  // ── Platform settings (platform-admin) ────────────────────────────────────
  platformSettings: {
    /**
     * ['platform-settings'] — the platform-wide settings list fetched by
     * PlatformSettings. This IS the query key (the list takes no params), not
     * merely an invalidation prefix: no mutation currently invalidates it,
     * because saves write partial updates client-side and rely on local form
     * state. Kept as `all` for shape-consistency with the other list families.
     */
    all: ['platform-settings'] as const,
  },

  // ── Org analytics (org-admin) ──────────────────────────────────────────────
  orgAnalyticsData: {
    /**
     * Full key: ['org-analytics-data', orgId]
     * Used by useOrgAnalyticsData / OrgAnalytics.tsx.
     */
    detail: (orgId: string | undefined) => ['org-analytics-data', orgId] as const,
  },

  orgCourseProgress: {
    /**
     * Full key: ['org-course-progress', orgId]
     * Used by useOrgCourseProgress / CourseProgressTab.tsx.
     */
    detail: (orgId: string | undefined) => ['org-course-progress', orgId] as const,
  },

  orgCourseEnrollees: {
    /**
     * Full key: ['org-course-enrollees', orgId, courseId]
     * Used by useOrgCourseEnrollees / CourseProgressTab.tsx.
     */
    detail: (orgId: string | undefined, courseId: string | undefined) =>
      ['org-course-enrollees', orgId, courseId] as const,
  },

  orgCourseOrgBreakdown: {
    /**
     * Full key: ['org-course-org-breakdown', courseId]
     * Used by useOrgCourseOrgBreakdown / CourseProgressTab.tsx — the per-org
     * engagement breakdown shown in the all-orgs course dialog (#163). Keyed by
     * courseId only (the endpoint is platform-admin, cross-org by construction).
     */
    detail: (courseId: string | undefined) =>
      ['org-course-org-breakdown', courseId] as const,
  },

  userProgress: {
    /**
     * Full key: ['user-progress', orgId, userId]
     * Used by useUserProgress / UserProgressDialog.tsx.
     */
    detail: (orgId: string | undefined, userId: string | undefined) =>
      ['user-progress', orgId, userId] as const,
  },

  // ── LMS / Courses (platform-admin) ─────────────────────────────────────────
  coursesAdmin: {
    /** ['courses-admin'] — the admin course list + access matrix (one query) */
    all: ['courses-admin'] as const,
  },

  courseStructureAdmin: {
    /**
     * Full key: ['course-structure-admin', courseId]
     * Used by CourseEditor.tsx.
     */
    detail: (courseId: string) => ['course-structure-admin', courseId] as const,
  },

  quizAdmin: {
    /**
     * Full key: ['quiz-admin', lessonId]
     * Used by QuizEditorDialog.tsx.
     */
    detail: (lessonId: string) => ['quiz-admin', lessonId] as const,
  },

  // ── Learner courses (learner) ──────────────────────────────────────────────
  learnerCourses: {
    /**
     * Full key: ['learner-courses', orgId]
     * Used by useLearnerCourses / Courses.tsx.
     * Exposed as `list` because enroll/unenroll mutations invalidate by this key.
     */
    list: (orgId: string | undefined) => ['learner-courses', orgId] as const,
  },

  // ── Learner dashboard (learner) ────────────────────────────────────────────
  learnerDashboard: {
    /**
     * Full key: ['learner-dashboard', orgId]
     * Used by useLearnerDashboard / Dashboard.tsx.
     */
    detail: (orgId: string | undefined) => ['learner-dashboard', orgId] as const,
  },
} as const;
