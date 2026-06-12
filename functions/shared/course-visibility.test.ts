import { describe, it, expect } from 'vitest';

import { courseVisibilityPredicate, orgCourseAccessEnabled } from './course-visibility';

// Collapse whitespace so the pins assert SQL shape, not formatting.
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('orgCourseAccessEnabled', () => {
  it('builds an EXISTS over org_course_access with a column course ref', () => {
    expect(flat(orgCourseAccessEnabled({ courseRef: 'c.id', orgParam: 1 }))).toBe(
      "EXISTS (SELECT 1 FROM org_course_access oca WHERE oca.course_id = c.id AND oca.org_id = $1 AND oca.access = 'enabled')",
    );
  });

  it('accepts a bind-parameter course ref and a non-1 org ordinal', () => {
    expect(flat(orgCourseAccessEnabled({ courseRef: '$2', orgParam: 1 }))).toBe(
      "EXISTS (SELECT 1 FROM org_course_access oca WHERE oca.course_id = $2 AND oca.org_id = $1 AND oca.access = 'enabled')",
    );
    expect(flat(orgCourseAccessEnabled({ courseRef: 'c.id', orgParam: 3 }))).toContain('oca.org_id = $3');
  });

  it('never includes a publish check (parity: org-course-progress shows unpublished courses)', () => {
    expect(orgCourseAccessEnabled({ courseRef: 'c.id', orgParam: 1 })).not.toContain('is_published');
  });
});

describe('courseVisibilityPredicate', () => {
  it('requires published AND enabled org access, keyed on the alias and ordinal', () => {
    expect(flat(courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 }))).toBe(
      'c.is_published = TRUE AND ' +
      "EXISTS (SELECT 1 FROM org_course_access oca WHERE oca.course_id = c.id AND oca.org_id = $1 AND oca.access = 'enabled')",
    );
  });

  it('threads a non-default alias and ordinal through both conjuncts', () => {
    const sql = flat(courseVisibilityPredicate({ courseAlias: 'crs', orgParam: 4 }));
    expect(sql).toContain('crs.is_published = TRUE');
    expect(sql).toContain('oca.course_id = crs.id');
    expect(sql).toContain('oca.org_id = $4');
  });

  it('hard-codes no ordinal: $1 appears only when asked for', () => {
    expect(courseVisibilityPredicate({ courseAlias: 'c', orgParam: 7 })).not.toContain('$1');
  });
});
