/**
 * Single owner for every app route path.
 *
 * The `<Route path>` in App.tsx and every navigate()/<Link>/redirect/sidebar/
 * breadcrumb target must use the SAME string. Defining each path once here
 * removes the hand-duplication that made the #120 rename touch ~15 files and let
 * OrgAnalytics' view-mode check (`isGlobalView`) drift from its route.
 *
 * Static paths are plain constants; parameterized routes expose a `*Pattern`
 * (with the `:param` placeholder, for `<Route path>`) plus a builder fn (for
 * navigate()/links). Keep values byte-for-byte identical to the route table.
 *
 * The `routes-gate.test.ts` gate scans `src/` and fails if any app route path
 * literal appears outside this file — adopt these constants, never re-inline.
 */
export const routes = {
  /** Public front door (unauthenticated landing); authed users redirect into the app. */
  root: '/',
  /** Bare '/app' redirect -> learner dashboard. */
  appRoot: '/app',
  /** Shared settings page (any authenticated user). */
  settings: '/app/settings',
  auth: {
    login: '/login',
    signup: '/signup',
    forgotPassword: '/forgot-password',
    resetPassword: '/reset-password',
  },
  learner: {
    dashboard: '/app/dashboard',
    /** Personal learning home — "My Training" / "Min Træning" (#364). */
    training: '/app/training',
    courses: '/app/courses',
    /** Course detail — "read about a course" before starting (#403). */
    courseDetailPattern: '/app/courses/:courseId',
    courseDetail: (courseId: string) => `/app/courses/${courseId}`,
    assessment: '/app/assessment',
    coursePlayerPattern: '/app/learn/:courseId',
    coursePlayer: (courseId: string) => `/app/learn/${courseId}`,
    /** Tips & Tricks — coming-soon placeholder (#366). Nav entry wired by #363. */
    tips: '/app/tips',
    /** Legacy redirect target -> dashboard. */
    certificates: '/app/certificates',
  },
  community: {
    feed: '/app/community',
    postDetailPattern: '/app/community/:scope/posts/:postId',
    postDetail: (scope: string, postId: string) => `/app/community/${scope}/posts/${postId}`,
    postEditPattern: '/app/community/:scope/posts/:postId/edit',
    postEdit: (scope: string, postId: string) => `/app/community/${scope}/posts/${postId}/edit`,
    ideas: '/app/community/org/ideas',
    ideaNew: '/app/community/org/ideas/new',
    ideaEditPattern: '/app/community/org/ideas/edit/:ideaId',
    ideaEdit: (ideaId: string) => `/app/community/org/ideas/edit/${ideaId}`,
    ideaDetailPattern: '/app/community/org/ideas/:ideaId',
    ideaDetail: (ideaId: string) => `/app/community/org/ideas/${ideaId}`,
    resources: '/app/community/org/resources',
  },
  orgAdmin: {
    /** OrgAnalytics, org-scoped view */
    root: '/app/admin/org',
    settings: '/app/admin/org/settings',
    ideas: '/app/admin/org/ideas',
    moderation: '/app/admin/org/moderation',
  },
  platformAdmin: {
    organizations: '/app/admin/platform/organizations',
    organizationDetailPattern: '/app/admin/platform/organizations/:orgId',
    organizationDetail: (orgId: string) => `/app/admin/platform/organizations/${orgId}`,
    courses: '/app/admin/platform/courses',
    courseEditorPattern: '/app/admin/platform/courses/:courseId',
    courseEditor: (courseId: string) => `/app/admin/platform/courses/${courseId}`,
    /** OrgAnalytics, platform-wide global view */
    analytics: '/app/admin/platform/analytics',
    settings: '/app/admin/platform/settings',
    moderation: '/app/admin/platform/moderation',
  },
} as const;
