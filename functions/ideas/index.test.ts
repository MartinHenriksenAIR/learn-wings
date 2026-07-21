import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsActiveMember, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('ideas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
    mockIsOrgAdmin.mockResolvedValue(false);
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

  // NOTE: validation runs before the authz check, so these 400 cases do NOT
  // consume an isActiveMember mock — leave it at the default (false).
  it('returns 400 when status is not an array of strings', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', status: 'submitted' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'status must be an array of strings' });
  });

  it('returns 400 when businessArea is not an array of strings', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', businessArea: [1, 2] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'businessArea must be an array of strings' });
  });

  it('returns 400 when tags is not an array of strings', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', tags: [1, 2] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns 400 when search is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', search: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'search must be a string' });
  });

  it('returns 400 when userId is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId must be a string' });
  });

  it('returns 403 when caller is not a member', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('returns 200 with ideas for an active member', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    const rows = [{ id: 'idea-1', title: 'Hello' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ideas: rows });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM ideas');
    expect(params).toContain('org-1');
  });

  it('scopes to the org and enforces draft-privacy on every role (param = caller profile id)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // org scoping
    expect(sql).toContain('i.org_id =');
    // draft visibility rule: drafts only visible to their author, no admin bypass
    expect(sql).toContain("i.status <> 'draft'");
    expect(sql).toContain('i.user_id =');
    // caller profile id must be a param so the author check works
    expect(params).toContain('p1');
  });

  it('platform admin is still bound by draft-privacy (no admin bypass) but skips membership', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    // draft rule present even for platform admin
    expect(sql).toContain("i.status <> 'draft'");
  });

  it('includes server-side comment_count and vote_count subqueries and profile embed', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);

    await handler(baseReq({ orgId: 'org-1' }), {} as any);

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('idea_comments');
    expect(sql).toContain('comment_count');
    expect(sql).toContain('idea_votes');
    expect(sql).toContain('vote_count');
    expect(sql).toContain('AS profile');
    // list does NOT compute user_has_voted (parity with old client)
    expect(sql).not.toContain('user_has_voted');
    expect(sql).toContain('ORDER BY i.created_at DESC');
  });

  it('filters by status array', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ orgId: 'org-1', status: ['submitted', 'approved'] }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('i.status');
    const p = params.find((x) => Array.isArray(x) && (x as string[]).includes('submitted'));
    expect(p).toEqual(['submitted', 'approved']);
  });

  it('filters by businessArea array', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ orgId: 'org-1', businessArea: ['hr', 'it'] }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('i.business_area');
    const p = params.find((x) => Array.isArray(x) && (x as string[]).includes('hr'));
    expect(p).toEqual(['hr', 'it']);
  });

  it('filters by tags overlap', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ orgId: 'org-1', tags: ['a', 'b'] }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('i.tags &&');
    const p = params.find((x) => Array.isArray(x) && (x as string[]).includes('a'));
    expect(p).toEqual(['a', 'b']);
  });

  it('filters by userId', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'author-9' }), {} as any);
    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('author-9');
  });

  it('filters by search over title/description/pain_points (parity with old three-field .or())', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ orgId: 'org-1', search: 'invoice' }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('i.title ILIKE');
    expect(sql).toContain('i.description ILIKE');
    expect(sql).toContain('i.pain_points ILIKE');
    expect(params).toContain('invoice');
  });

  it('returns 500 on db error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  // #180 — idea author payload must carry avatar_url.
  it('joins avatar_url into the idea author profile payload', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    const rows = [{ id: 'idea-1', profile: { id: 'a1', full_name: 'Ann', avatar_url: 'avatars/a1.png' } }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'avatar_url', pr.avatar_url");
    expect(JSON.parse(res.body as string).ideas[0].profile.avatar_url).toBe('avatars/a1.png');
  });
});
