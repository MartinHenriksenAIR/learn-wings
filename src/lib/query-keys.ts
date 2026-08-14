export const queryKeys = {
  organizations: {
    all: ['organizations'] as const,
  },

  brandingAsset: {
    signed: (blobPath: string) => ['branding-asset', blobPath] as const,
  },

  communityCategories: {
    all: ['community-categories'] as const,
  },

  courseCategories: {
    all: ['course-categories'] as const,
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
    list: (scope: string, activeTab: string) =>
      ['platform-reports', scope, activeTab] as const,
  },

  aiChampions: {
    list: (orgId: string | undefined) => ['ai-champions', orgId] as const,
  },

  profiles: {
    all: ['profiles'] as const,
  },

  orgMemberships: {
    list: (orgId: string | undefined) => ['org-memberships', orgId] as const,
  },

  invitations: {
    list: (orgId: string | undefined, scope: string) =>
      ['invitations', orgId, scope] as const,
  },

  orgDetail: {
    detail: (orgId: string | undefined) => ['org-detail', orgId] as const,
  },

  platformSettings: {
    all: ['platform-settings'] as const,
  },

  orgSettings: {
    detail: (orgId: string | undefined) => ['org-settings', orgId] as const,
  },

  orgAnalyticsData: {
    detail: (orgId: string | undefined) => ['org-analytics-data', orgId] as const,
  },

  orgCourseProgress: {
    detail: (orgId: string | undefined, adminLang: string | undefined) =>
      ['org-course-progress', orgId, adminLang] as const,
  },

  orgCourseEnrollees: {
    detail: (orgId: string | undefined, courseId: string | undefined) =>
      ['org-course-enrollees', orgId, courseId] as const,
  },

  orgCourseOrgBreakdown: {
    detail: (courseId: string | undefined) =>
      ['org-course-org-breakdown', courseId] as const,
  },

  userProgress: {
    detail: (orgId: string | undefined, userId: string | undefined) =>
      ['user-progress', orgId, userId] as const,
  },

  coursesAdmin: {
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
    list: (orgId: string | undefined) => ['learner-courses', orgId] as const,
  },

  learnerCourseDetail: {
    detail: (orgId: string | undefined, courseId: string | undefined) =>
      ['learner-course-detail', orgId, courseId] as const,
  },

  learnerDashboard: {
    detail: (orgId: string | undefined) => ['learner-dashboard', orgId] as const,
  },

  learnerTraining: {
    detail: (orgId: string | undefined) => ['learner-training', orgId] as const,
  },

  learnerAssignments: {
    list: (orgId: string | undefined) => ['learner-assignments', orgId] as const,
  },

  assignments: {
    list: (orgId: string | undefined) => ['assignments', orgId] as const,
  },

  orgCourseAccess: {
    list: (orgId: string | undefined) => ['org-course-access', orgId] as const,
  },

  favorites: {
    list: (orgId: string | undefined) => ['favorites', orgId] as const,
  },

  assessment: {
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
