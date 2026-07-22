import { describe, it, expect } from 'vitest';
import { courseGroupKey, courseGroupMemberIds, siblingEnrollmentExists } from './course-groups';

describe('courseGroupKey', () => {
  it('coalesces course_group_id to id for the given alias', () => {
    expect(courseGroupKey('c')).toBe('COALESCE(c.course_group_id, c.id)');
  });
});

describe('courseGroupMemberIds', () => {
  it('selects every course id sharing the group of the course at the given ordinal', () => {
    const sql = courseGroupMemberIds(2);
    expect(sql).toContain('FROM courses gm');
    expect(sql).toContain('COALESCE(gm.course_group_id, gm.id)');
    expect(sql).toContain('WHERE gc.id = $2');
  });
});

describe('siblingEnrollmentExists', () => {
  it('builds an EXISTS predicate over a different edition of the same group', () => {
    const sql = siblingEnrollmentExists({ orgParam: 1, userParam: 2, courseParam: 3 });
    expect(sql.startsWith('EXISTS (')).toBe(true);
    expect(sql).toContain('e.org_id = $1');
    expect(sql).toContain('e.user_id = $2');
    expect(sql).toContain('target.id = $3');
    expect(sql).toContain('target.course_group_id IS NOT NULL');
    expect(sql).toContain('sib.course_group_id = target.course_group_id');
    expect(sql).toContain('sib.id <> target.id');
  });
});
