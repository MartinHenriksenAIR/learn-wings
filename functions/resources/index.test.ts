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
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('resources (list)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(true);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when orgId is not a string', async () => {
    const res = await handler(baseReq({ orgId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when search is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', search: 7 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'search must be a string' });
  });

  it('returns 400 when resource_type is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', resource_type: 5 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'resource_type must be a string' });
  });

  it('returns 400 when tags is not an array of strings', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', tags: ['a', 1] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns 403 when caller is not an active member of the org', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('happy path: returns resources for an active member, ordered by pinned DESC, created DESC', async () => {
    const rows = [
      { id: 'r1', org_id: 'org-1', is_pinned: true, profile: { id: 'p1', full_name: 'A', department: null } },
      { id: 'r2', org_id: 'org-1', is_pinned: false, profile: null },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ resources: rows });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM community_resources');
    expect(sql).toContain('LEFT JOIN profiles');
    expect(sql).toContain('ORDER BY r.is_pinned DESC, r.created_at DESC');
    expect(params).toEqual(['org-1']);
  });

  it('platform admin lists without membership', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('applies resource_type filter', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await handler(baseReq({ orgId: 'org-1', resource_type: 'guide' }), {} as any);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('r.resource_type = $');
    expect(params).toContain('guide');
  });

  it('applies tags filter (overlap)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await handler(baseReq({ orgId: 'org-1', tags: ['a', 'b'] }), {} as any);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('r.tags && $');
    expect(params).toContainEqual(['a', 'b']);
  });

  it('applies search filter against title OR description', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await handler(baseReq({ orgId: 'org-1', search: 'prompt' }), {} as any);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/r\.title ILIKE.+OR r\.description ILIKE/);
    expect(params).toContain('prompt');
  });

  it('returns 500 on db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
