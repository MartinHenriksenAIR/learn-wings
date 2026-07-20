/**
 * Single owner for the admin-area route paths.
 *
 * The `<Route path>` in App.tsx and every navigate()/<Link>/sidebar/breadcrumb
 * target for the admin area must use the SAME string. Defining each path once
 * here removes the hand-duplication that made the #120 rename touch ~15 files
 * and let OrgAnalytics' view-mode check (`isGlobalView`) drift from its route.
 *
 * Static paths are plain constants; parameterized routes expose a `*Pattern`
 * (with the `:param` placeholder, for `<Route path>`) plus a builder fn (for
 * navigate()/links). Keep values byte-for-byte identical to the route table.
 *
 * Scope: admin routes only for now — #178 tracks extending this to the
 * learner/community/auth routes and adopting it app-wide.
 */
export const routes = {
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
