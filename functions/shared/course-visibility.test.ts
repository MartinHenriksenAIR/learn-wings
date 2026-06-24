import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

// Drift guard mirroring lms-asset.test.ts: the predicate above is pinned by hand
// against an inline comment, so a change to the canonical visibility rule in
// migration/azure/01-schema.sql would NOT be caught. These read the schema and
// fail if a column the predicate depends on is renamed/retyped, or if the
// canonical rule (embedded in can_user_access_lms_asset) drops or renames one
// of the published/org-enabled conjuncts courseVisibilityPredicate emits.
describe('schema-drift parity guard', () => {
  const schema = readFileSync(resolve(__dirname, '../../migration/azure/01-schema.sql'), 'utf8');

  const tableBody = (table: string) => {
    const m = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`));
    expect(m, `${table} table not found in schema`).not.toBeNull();
    return m![1];
  };

  it('courses still declares the is_published boolean the predicate gates on', () => {
    expect(tableBody('courses')).toMatch(/^\s*is_published\s+boolean/m);
  });

  it('org_course_access still declares the uuid org_id/course_id and access_type access columns the EXISTS clause joins on', () => {
    const body = tableBody('org_course_access');
    // Pin name AND type (mirroring the courses `is_published boolean` check) so a
    // retype — e.g. access enum → text, org_id uuid → bigint — also trips the guard.
    const columns = { org_id: 'uuid', course_id: 'uuid', access: 'public\\.access_type' };
    for (const [col, type] of Object.entries(columns)) {
      expect(body, `org_course_access.${col} missing or retyped`).toMatch(
        new RegExp(`^\\s*${col}\\s+${type}\\b`, 'm'),
      );
    }
  });

  it('canonical rule and courseVisibilityPredicate both contain the three published + org-enabled conjuncts', () => {
    // Substring pin, not a structural diff: catches a conjunct being dropped or
    // renamed on either side, but NOT one being widened while the literal
    // survives (e.g. access = 'enabled' → access IN ('enabled', 'trial')).
    const fnMatch = schema.match(
      /FUNCTION public\.can_user_access_lms_asset[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
    );
    expect(fnMatch).not.toBeNull();
    const canonical = flat(fnMatch![1]);
    const predicate = flat(courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 }));

    for (const conjunct of ['c.is_published = TRUE', 'oca.course_id = c.id', "oca.access = 'enabled'"]) {
      expect(canonical, `canonical rule no longer contains: ${conjunct}`).toContain(conjunct);
      expect(predicate, `predicate no longer emits: ${conjunct}`).toContain(conjunct);
    }
  });
});
