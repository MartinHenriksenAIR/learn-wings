/**
 * Shared SQL fragments for the course-visibility rule:
 * a course is visible to an org when it is PUBLISHED and the org has an
 * 'enabled' org_course_access row for it.
 *
 * RLS provenance: supabase/migrations/ courses policy ("published + enabled
 * org access") / migration/azure/01-schema.sql. Before this module the
 * predicate was hand-rolled in 5 endpoints (enroll, learner-courses,
 * org-course-progress, enrollment-create, user-progress) — one copy embedded
 * a hard-coded `$1` ordinal inside an interpolated fragment, silently coupled
 * to the caller's param order. Here the ordinal is an explicit argument.
 *
 * These builders interpolate SQL *identifiers/ordinals* supplied by the
 * endpoint author — never user input. Values still travel as bind parameters.
 */

export interface OrgCourseAccessOpts {
  /** SQL reference to the course id — a column like 'c.id' or a bind like '$2'. */
  courseRef: string;
  /** 1-based bind-parameter ordinal carrying the org id (rendered as $n). */
  orgParam: number;
}

/**
 * EXISTS(...) — the org has an 'enabled' org_course_access row for the course.
 * No publish check (org-course-progress deliberately shows unpublished
 * courses for parity with the pre-migration UI).
 */
export function orgCourseAccessEnabled({ courseRef, orgParam }: OrgCourseAccessOpts): string {
  return `EXISTS (SELECT 1 FROM org_course_access oca
                   WHERE oca.course_id = ${courseRef} AND oca.org_id = $${orgParam} AND oca.access = 'enabled')`;
}

export interface CourseVisibilityOpts {
  /** Alias of the in-scope courses table (e.g. 'c'). */
  courseAlias: string;
  /** 1-based bind-parameter ordinal carrying the org id (rendered as $n). */
  orgParam: number;
}

/** Full visibility predicate over an in-scope courses alias: published AND org-enabled. */
export function courseVisibilityPredicate({ courseAlias, orgParam }: CourseVisibilityOpts): string {
  return `${courseAlias}.is_published = TRUE
          AND ${orgCourseAccessEnabled({ courseRef: `${courseAlias}.id`, orgParam })}`;
}
