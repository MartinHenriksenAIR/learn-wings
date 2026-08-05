import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('learner-assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'learner-1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(true);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    expect((await handler(req, {} as any)).status).toBe(204);
  });

  it('returns 401 when token invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    expect((await handler(baseReq({ orgId: 'org-1' }), {} as any)).status).toBe(401);
  });

  it('returns 400 when orgId missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 403 when caller is not an active member of the org', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('resolves individual + whole-org assignments deduped, scoped to (orgId, caller)', async () => {
    mockQuery.mockResolvedValueOnce([
      { course_id: 'c1', course_title: 'AI Basics', thumbnail_url: 'org-logos/x.png', mandatory: true, due_date: '2026-09-01', completed: false, overdue: false },
    ]);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['org-1', 'learner-1']);
    expect(sql).toContain('FROM course_assignments');
    expect(sql).toContain('bool_or(ca.mandatory)');
    expect(sql).toContain('min(ca.due_date)');
    expect(sql).toContain('ca.user_id = $2 OR ca.user_id IS NULL');
    expect(sql).toContain('c.is_published');
    expect(JSON.parse(res.body as string)).toEqual({
      assignments: [
        { course_id: 'c1', course_title: 'AI Basics', thumbnail_url: 'org-logos/x.png', mandatory: true, due_date: '2026-09-01', completed: false, overdue: false },
      ],
    });
  });

  it('normalizes a NULL overdue (no due date) to false', async () => {
    mockQuery.mockResolvedValueOnce([
      { course_id: 'c2', course_title: 'AI Ethics', thumbnail_url: null, mandatory: false, due_date: null, completed: false, overdue: null },
    ]);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).assignments[0].overdue).toBe(false);
  });

  it('returns 500 on generic db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
