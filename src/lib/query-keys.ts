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
 */
export const queryKeys = {
  // ── Organizations ──────────────────────────────────────────────────────────
  organizations: {
    /** ['organizations'] */
    all: ['organizations'] as const,
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
     * Parameter order matches CommunityFeed.tsx line 70.
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
     * Parameter order matches IdeaLibrary.tsx line 90.
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
     * Parameter order matches OrgIdeasManagement.tsx line 92.
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
     * Parameter order matches ResourceLibrary.tsx line 72.
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
     * Parameter order matches OrgCommunityModeration.tsx line 62.
     */
    list: (orgId: string | undefined, activeTab: string) =>
      ['org-reports', orgId, activeTab] as const,
  },

  platformReports: {
    /** ['platform-reports'] — use for invalidation prefix */
    all: ['platform-reports'] as const,
    /**
     * Full key: ['platform-reports', activeTab]
     * Parameter order matches PlatformCommunityModeration.tsx line 58.
     */
    list: (activeTab: string) => ['platform-reports', activeTab] as const,
  },

  // ── AI Champions ───────────────────────────────────────────────────────────
  aiChampions: {
    /**
     * Full key: ['ai-champions', orgId]
     * Used by AIChampionsList.tsx.
     */
    list: (orgId: string) => ['ai-champions', orgId] as const,
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
} as const;
