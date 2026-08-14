import { describe, it, expect, vi } from 'vitest';

vi.mock('./db', () => ({ queryOne: vi.fn() }));

import { queryOne } from './db';
import {
  courseVisibilityPredicate,
  individualCourseVisibility,
  orgCourseAccessEnabled,
  resolveVisibilityContext,
} from './course-visibility';
import { functionBody, tableBody } from './__fixtures__/schema';

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

describe('individualCourseVisibility', () => {
  it('is published + language, with no org-access clause', () => {
    const sql = individualCourseVisibility({ courseAlias: 'c', langParam: 2 });
    expect(sql).toContain('c.is_published = TRUE');
    expect(sql).toContain('c.language = $2');
    expect(sql).not.toContain('org_course_access');
  });
});

describe('resolveVisibilityContext', () => {
  it('flags individual orgs and reads saved language', async () => {
    (queryOne as any).mockResolvedValueOnce({ kind: 'individual', language: 'en' });
    await expect(resolveVisibilityContext('org-1', 'p1')).resolves.toEqual({ isIndividual: true, language: 'en' });
    (queryOne as any).mockResolvedValueOnce({ kind: 'standard', language: null });
    await expect(resolveVisibilityContext('org-2', 'p1')).resolves.toEqual({ isIndividual: false, language: 'da' });
  });
});

describe('schema-drift parity guard', () => {
  it('courses still declares the is_published boolean the predicate gates on', () => {
    expect(tableBody('courses')).toMatch(/^\s*is_published\s+boolean/m);
  });

  it('org_course_access still declares the uuid org_id/course_id and access_type access columns the EXISTS clause joins on', () => {
    const body = tableBody('org_course_access');
    const columns = { org_id: 'uuid', course_id: 'uuid', access: 'public\\.access_type' };
    for (const [col, type] of Object.entries(columns)) {
      expect(body, `org_course_access.${col} missing or retyped`).toMatch(
        new RegExp(`^\\s*${col}\\s+${type}\\b`, 'm'),
      );
    }
  });

  it('canonical rule and courseVisibilityPredicate both contain the three published + org-enabled conjuncts', () => {
    const canonical = flat(functionBody('can_user_access_lms_asset'));
    const predicate = flat(courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 }));

    for (const conjunct of ['c.is_published = TRUE', 'oca.course_id = c.id', "oca.access = 'enabled'"]) {
      expect(canonical, `canonical rule no longer contains: ${conjunct}`).toContain(conjunct);
      expect(predicate, `predicate no longer emits: ${conjunct}`).toContain(conjunct);
    }
  });
});
