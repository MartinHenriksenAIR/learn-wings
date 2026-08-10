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

import { queryOne } from './db';
import { INDIVIDUAL_ORG_KIND } from './individual-tier';

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

export interface IndividualVisibilityOpts {
  /** Alias of the in-scope courses table (e.g. 'c'). */
  courseAlias: string;
  /** 1-based bind-parameter ordinal carrying the caller's language (rendered $n). */
  langParam: number;
}

/**
 * Visibility for the individual tier (#354): a published course in the caller's
 * language, with org_course_access DELIBERATELY bypassed. NULL-language courses
 * are excluded naturally by the equality. Never used for standard orgs.
 */
export function individualCourseVisibility({ courseAlias, langParam }: IndividualVisibilityOpts): string {
  return `${courseAlias}.is_published = TRUE AND ${courseAlias}.language = $${langParam}`;
}

/**
 * Resolve, in one round-trip, whether an org is the individual tier and the
 * caller's server-authoritative catalogue language. Endpoints on the learner
 * journey call this to pick the standard vs individual visibility branch. The
 * client never supplies the language for individuals (they cannot widen their
 * own catalogue). Defaults language to 'da' when the profile value is null.
 */
export async function resolveVisibilityContext(
  orgId: string,
  profileId: string,
): Promise<{ isIndividual: boolean; language: string }> {
  const row = await queryOne<{ kind: string | null; language: string | null }>(
    `SELECT (SELECT kind FROM organizations WHERE id = $1) AS kind,
            (SELECT preferred_language FROM profiles WHERE id = $2) AS language`,
    [orgId, profileId],
  );
  return {
    isIndividual: row?.kind === INDIVIDUAL_ORG_KIND,
    language: row?.language === 'en' ? 'en' : 'da',
  };
}
