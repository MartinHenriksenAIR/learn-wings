import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'admin-uuid', email: 'admin@contoso.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery, mockQueryOne, mockClientQuery, mockWithTransaction } = vi.hoisted(() => {
  const mockClientQuery = vi.fn();
  return {
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockClientQuery,
    // withTransaction runs its callback against a mock client — mirrors the
    // org-membership-create test harness (real BEGIN/COMMIT/FOR UPDATE is
    // exercised by the DATABASE_URL-gated integration tests in shared/db.test.ts).
    mockWithTransaction: vi.fn(async (cb: (client: { query: typeof mockClientQuery }) => unknown) => cb({ query: mockClientQuery })),
  };
});
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, withTransaction: mockWithTransaction }));

import handler from './index';

const baseReq = (body: object) => ({
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => body,
});

describe('admin-user-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 if requesting user is not a platform admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false });

    const res = await handler(baseReq({ action: 'update-member-role', membership_id: 'mem-uuid', role: 'learner' }) as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('rejects the removed toggle-platform-admin action (use /api/platform-admin-update)', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });

    const res = await handler(baseReq({ action: 'toggle-platform-admin', target_user_id: 'target-uuid', value: true }) as any, {} as any);

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('removes a membership when action is remove-membership', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true }); // admin check
    mockQuery.mockResolvedValueOnce([]);                              // DELETE

    const res = await handler(baseReq({ action: 'remove-membership', membership_id: 'mem-uuid' }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const deleteCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('DELETE'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toContain('mem-uuid');
  });

  it('returns 400 for an unknown action', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });

    const res = await handler(baseReq({ action: 'do-something-weird' }) as any, {} as any);

    expect(res.status).toBe(400);
  });

  describe('add-membership', () => {
    it('adds a membership when the org is under the seat limit, defaulting role to learner', async () => {
      mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true }); // admin check
      mockClientQuery.mockResolvedValueOnce({ rows: [{ seat_limit: null, active_count: 5, pending_count: 0 }] }); // seat lookup
      mockClientQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

      const res = await handler(
        baseReq({ action: 'add-membership', org_id: 'org-1', target_user_id: 'user-1' }) as any,
        {} as any
      );
      const body = JSON.parse(res.body);

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      const [insertSql, insertParams] = mockClientQuery.mock.calls[1] as [string, unknown[]];
      expect(insertSql).toContain('INSERT INTO org_memberships');
      expect(insertParams).toEqual(['org-1', 'user-1', 'learner']);
    });

    it('adds a membership with an explicit org_admin role', async () => {
      mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });
      mockClientQuery.mockResolvedValueOnce({ rows: [{ seat_limit: 10, active_count: 2, pending_count: 0 }] });
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const res = await handler(
        baseReq({ action: 'add-membership', org_id: 'org-1', target_user_id: 'user-2', role: 'org_admin' }) as any,
        {} as any
      );

      expect(res.status).toBe(200);
      const [, insertParams] = mockClientQuery.mock.calls[1] as [string, unknown[]];
      expect(insertParams).toEqual(['org-1', 'user-2', 'org_admin']);
    });

    it('returns 409 seat limit reached when active + pending are at the limit, without inserting', async () => {
      mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });
      mockClientQuery.mockResolvedValueOnce({ rows: [{ seat_limit: 5, active_count: 5, pending_count: 0 }] });

      const res = await handler(
        baseReq({ action: 'add-membership', org_id: 'org-1', target_user_id: 'user-3' }) as any,
        {} as any
      );
      const body = JSON.parse(res.body);

      expect(res.status).toBe(409);
      expect(body).toEqual({ error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
      expect(mockClientQuery).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when the organization does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });
      mockClientQuery.mockResolvedValueOnce({ rows: [] }); // no org row

      const res = await handler(
        baseReq({ action: 'add-membership', org_id: 'missing-org', target_user_id: 'user-1' }) as any,
        {} as any
      );
      const body = JSON.parse(res.body);

      expect(res.status).toBe(404);
      expect(body).toEqual({ error: 'Organization not found' });
      expect(mockClientQuery).toHaveBeenCalledTimes(1);
    });
  });
});
