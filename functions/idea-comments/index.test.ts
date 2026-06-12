import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const submittedIdea = {
  id: 'idea-1',
  org_id: 'org-1',
  user_id: 'p2',
  status: 'submitted',
};

// draft owned by p2 (not the caller p1)
const othersDraft = {
  id: 'idea-2',
  org_id: 'org-1',
  user_id: 'p2',
  status: 'draft',
};

// draft owned by p1 (the caller)
const ownDraft = {
  id: 'idea-3',
  org_id: 'org-1',
  user_id: 'p1',
  status: 'draft',
};

const sampleComment = {
  id: 'c1',
  idea_id: 'idea-1',
  user_id: 'p2',
  content: 'Hello',
  created_at: '2026-01-01T00:00:00Z',
  profile: { id: 'p2', full_name: 'Bob' },
};

describe('idea-comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when ideaId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when ideaId is not a string', async () => {
    const res = await handler(baseReq({ ideaId: 5 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  // RLS parity: missing idea → 200 {comments: []}
  it('returns 200 empty comments when idea not found (RLS parity)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // idea load → null
    const res = await handler(baseReq({ ideaId: 'idea-999' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [] });
    // comments query must NOT be issued
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Draft privacy: other-author's draft → 200 {comments: []}
  it('returns 200 empty comments for another author\'s draft', async () => {
    mockQueryOne.mockResolvedValueOnce(othersDraft);
    const res = await handler(baseReq({ ideaId: 'idea-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // No-admin-bypass on draft visibility
  it('returns 200 empty comments for another author\'s draft even when caller is platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(othersDraft);
    const res = await handler(baseReq({ ideaId: 'idea-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Non-member → 200 {comments: []}
  it('returns 200 empty comments when caller is not a member', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea);
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Own draft → comments returned
  it('returns comments for caller\'s own draft', async () => {
    mockQueryOne.mockResolvedValueOnce(ownDraft);
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([sampleComment]);
    const res = await handler(baseReq({ ideaId: 'idea-3' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [sampleComment] });
  });

  // Happy member path asserting SQL shape
  it('happy path: returns comments with profile embed ordered by created_at ASC', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea);
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([sampleComment]);
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [sampleComment] });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM idea_comments c');
    expect(sql).toContain('JOIN profiles pr');
    expect(sql).toContain('json_build_object');
    expect(sql).toContain('ORDER BY c.created_at ASC');
    expect(params).toContain('idea-1');
  });

  // Platform admin bypasses membership check
  it('platform admin bypasses membership check and gets comments', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(submittedIdea);
    mockQuery.mockResolvedValueOnce([sampleComment]);
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [sampleComment] });
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ ideaId: 'idea-1' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
