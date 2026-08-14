import { queryOne } from './db';
import { INDIVIDUAL_ORG_KIND } from './individual-tier';

export interface OrgCourseAccessOpts {
  courseRef: string;
  orgParam: number;
}

export function orgCourseAccessEnabled({ courseRef, orgParam }: OrgCourseAccessOpts): string {
  return `EXISTS (SELECT 1 FROM org_course_access oca
                   WHERE oca.course_id = ${courseRef} AND oca.org_id = $${orgParam} AND oca.access = 'enabled')`;
}

export interface CourseVisibilityOpts {
  courseAlias: string;
  orgParam: number;
}

export function courseVisibilityPredicate({ courseAlias, orgParam }: CourseVisibilityOpts): string {
  return `${courseAlias}.is_published = TRUE
          AND ${orgCourseAccessEnabled({ courseRef: `${courseAlias}.id`, orgParam })}`;
}

export interface IndividualVisibilityOpts {
  courseAlias: string;
  langParam: number;
}

export function individualCourseVisibility({ courseAlias, langParam }: IndividualVisibilityOpts): string {
  return `${courseAlias}.is_published = TRUE AND ${courseAlias}.language = $${langParam}`;
}

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
