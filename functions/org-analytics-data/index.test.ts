import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', email: 'admin@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ orgId: 'org-uuid' }),
};

const allOrgsReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ orgId: 'all' }),
};

describe('org-analytics-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for users without access', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns members, enrollments, quizAttempts, and org for authorized user', async () => {
    const members = [{ id: 'mem-1', full_name: 'Alice', assessment_level: 'beginner' }];
    const enrollments = [{ id: 'enr-1', course_id: 'c-1' }];
    const quizAttempts = [{ id: 'qa-1', score: 80 }];
    const org = { id: 'org-uuid', name: 'Test Org' };

    mockQueryOne.mockResolvedValueOnce({ can_access: true }); // auth check
    // Promise.all: members, enrollments, quizAttempts (query), org (queryOne)
    mockQuery.mockResolvedValueOnce(members);
    mockQuery.mockResolvedValueOnce(enrollments);
    mockQuery.mockResolvedValueOnce(quizAttempts);
    mockQueryOne.mockResolvedValueOnce(org);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.members).toHaveLength(1);
    expect(body.enrollments).toHaveLength(1);
    expect(body.quizAttempts).toHaveLength(1);
    expect(body.org.name).toBe('Test Org');
    // assessment_level is present in single-org members rows
    expect(body.members[0].assessment_level).toBe('beginner');
    // SQL includes p.assessment_level
    const [membersSql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(membersSql).toContain('p.assessment_level');
  });

  it('returns 403 when an org admin requests a different org (tenant isolation)', async () => {
    // Simulate: the authz check returns can_access = false for a cross-org request.
    // This mirrors the case where an org admin of org A requests org B.
    mockQueryOne.mockResolvedValueOnce({ can_access: false });

    const crossOrgReq = {
      method: 'POST',
      headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
      json: async () => ({ orgId: 'different-org-uuid' }),
    };

    const res = await handler(crossOrgReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('Forbidden');
  });

  // ── All-orgs aggregate (orgId 'all') — platform admins only ──────────────
  describe('all-orgs aggregate (orgId "all")', () => {
    it('returns 403 for a non-platform-admin', async () => {
      mockQueryOne.mockResolvedValueOnce({ is_admin: false }); // platform-admin check

      const res = await handler(allOrgsReq as any, {} as any);

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body).error).toBe('Forbidden');
    });

    it('aggregates distinct members + all enrollments/attempts across orgs for a platform admin', async () => {
      const members = [
        { user_id: 'u1', role: 'org_admin', full_name: 'Alice', email: 'a@x.com', department: 'Eng', assessment_level: null },
        { user_id: 'u2', role: 'learner', full_name: 'Bob', email: 'b@x.com', department: null, assessment_level: 'beginner' },
      ];
      const enrollments = [
        { id: 'e1', course_id: 'c1', status: 'completed', user_id: 'u1' },
        { id: 'e2', course_id: 'c1', status: 'active', user_id: 'u2' },
      ];
      const quizAttempts = [{ id: 'qa1', score: 90, user_id: 'u1' }];

      mockQueryOne.mockResolvedValueOnce({ is_admin: true }); // platform-admin check
      mockQuery.mockResolvedValueOnce(members);
      mockQuery.mockResolvedValueOnce(enrollments);
      mockQuery.mockResolvedValueOnce(quizAttempts);

      const res = await handler(allOrgsReq as any, {} as any);
      const body = JSON.parse(res.body);

      expect(res.status).toBe(200);
      expect(body.members).toHaveLength(2);
      expect(body.enrollments).toHaveLength(2);
      expect(body.quizAttempts).toHaveLength(1);

      // assessment_level is present in all-orgs members rows
      expect(body.members[0].assessment_level).toBeNull();    // org_admin → null (skipped/not prompted)
      expect(body.members[1].assessment_level).toBe('beginner');

      // members query dedups by user; enrollments/attempts span all orgs (no org bind param)
      const [membersSql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(membersSql).toContain('DISTINCT ON');
      // department is a profiles column, not an org_memberships one (om.department would 500)
      expect(membersSql).toContain('p.department');
      expect(membersSql).not.toContain('om.department');
      // om.role and p.assessment_level are included for level-distribution exclusion logic
      expect(membersSql).toContain('om.role');
      expect(membersSql).toContain('p.assessment_level');
      // ORDER BY includes om.role so org_admin rows win for dual-role users
      expect(membersSql).toContain('ORDER BY p.id, om.role');
      const enrollmentsCall = mockQuery.mock.calls[1] as [string, unknown[]?];
      expect(enrollmentsCall[0]).not.toContain('$1');
      expect(enrollmentsCall[0]).not.toContain('org_id =');
    });

    it('does not run the single-org authz join for an all-orgs request', async () => {
      mockQueryOne.mockResolvedValueOnce({ is_admin: true });
      mockQuery.mockResolvedValue([]);

      await handler(allOrgsReq as any, {} as any);

      // exactly one queryOne (the platform-admin check), never the can_access join
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [authSql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
      expect(authSql).not.toContain('can_access');
      expect(authSql).toContain('is_platform_admin');
    });
  });
});
