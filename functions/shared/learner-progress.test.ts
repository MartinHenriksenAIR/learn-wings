import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));

import { getLearnerProgress } from './learner-progress';

describe('getLearnerProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns enrollments and zero-filled progress, issuing the 3 queries in order', async () => {
    const enrollmentRows = [
      {
        id: 'e1', org_id: 'org-1', user_id: 'p1', course_id: 'c1',
        status: 'enrolled', enrolled_at: '2024-01-01', completed_at: null,
        course: { id: 'c1', title: 'Course 1', description: null, level: 'beginner',
                  is_published: true, thumbnail_url: null, created_by_user_id: 'p2', created_at: '2024-01-01' },
      },
      {
        id: 'e2', org_id: 'org-1', user_id: 'p1', course_id: 'c2',
        status: 'enrolled', enrolled_at: '2024-01-02', completed_at: null,
        course: { id: 'c2', title: 'Course 2', description: null, level: 'intermediate',
                  is_published: true, thumbnail_url: null, created_by_user_id: 'p2', created_at: '2024-01-02' },
      },
    ];
    // totals: only c1 has lessons, c2 has none
    const totalsRows = [{ course_id: 'c1', total: 5 }];
    // completed: only c1 has progress, c2 has none
    const completedRows = [{ course_id: 'c1', completed: 3 }];

    mockQuery
      .mockResolvedValueOnce(enrollmentRows) // enrollments query
      .mockResolvedValueOnce(totalsRows)     // totals query
      .mockResolvedValueOnce(completedRows); // completed query

    const result = await getLearnerProgress('p1', 'org-1');

    expect(result.enrollments).toEqual(enrollmentRows);
    // Zero-fill proven: c2 has 0/0
    expect(result.progress).toEqual({
      c1: { total: 5, completed: 3 },
      c2: { total: 0, completed: 0 },
    });

    expect(mockQuery).toHaveBeenCalledTimes(3);

    const [enrollSql, enrollParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(enrollSql).toContain('e.user_id = $1');
    expect(enrollSql).toContain('e.org_id = $2');
    expect(enrollSql).toContain('json_build_object');
    expect(enrollParams).toEqual(['p1', 'org-1']);

    const [totalsSql, totalsParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(totalsSql).toContain('ANY($1::uuid[])');
    expect(totalsParams).toEqual([['c1', 'c2']]);

    const [completedSql, completedParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(completedSql).toContain("lp.status = 'completed'");
    expect(completedSql).toContain('ANY($3::uuid[])');
    expect(completedParams).toEqual(['p1', 'org-1', ['c1', 'c2']]);
  });

  it('returns empty data and issues exactly one query when there are no enrollments', async () => {
    mockQuery.mockResolvedValueOnce([]); // empty enrollments

    const result = await getLearnerProgress('p1', 'org-1');

    expect(result).toEqual({ enrollments: [], progress: {} });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
