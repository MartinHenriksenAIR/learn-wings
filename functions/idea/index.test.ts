import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsActiveMember, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

// A non-draft idea owned by someone else (p2) in org-1
const submittedIdea = {
  id: 'idea-1',
  org_id: 'org-1',
  user_id: 'p2',
  status: 'submitted',
  title: 'Submitted Idea',
};

// A draft idea owned by someone else (p2)
const othersDraft = {
  id: 'idea-2',
  org_id: 'org-1',
  user_id: 'p2',
  status: 'draft',
  title: 'Their Draft',
};

// A draft idea owned by the caller (p1)
const ownDraft = {
  id: 'idea-3',
  org_id: 'org-1',
  user_id: 'p1',
  status: 'draft',
  title: 'My Draft',
};

describe('idea', () => {
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
    const res = await handler(baseReq({ ideaId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 200 { idea: null } when idea not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ ideaId: 'idea-999' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: null });
  });

  it('passes the caller profile id for user_has_voted and selects counts + embeds', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea);
    mockIsActiveMember.mockResolvedValueOnce(true);
    await handler(baseReq({ ideaId: 'idea-1' }), {} as any);

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM ideas');
    expect(sql).toContain('comment_count');
    expect(sql).toContain('vote_count');
    expect(sql).toContain('user_has_voted');
    expect(sql).toContain('AS profile');
    expect(sql).toContain('AS organization');
    // both ideaId and caller profile id are params
    expect(params).toContain('idea-1');
    expect(params).toContain('p1');
  });

  it('returns 200 { idea } for a non-draft idea when caller is an active member', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea);
    mockIsActiveMember.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: submittedIdea });
  });

  it('returns 200 { idea: null } when caller is not a member of the idea org', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea);
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: null });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('returns 200 { idea: null } for another author\'s draft (no admin bypass)', async () => {
    mockQueryOne.mockResolvedValueOnce(othersDraft);
    mockIsActiveMember.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ ideaId: 'idea-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: null });
  });

  it('returns 200 { idea } for the caller\'s own draft', async () => {
    mockQueryOne.mockResolvedValueOnce(ownDraft);
    mockIsActiveMember.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ ideaId: 'idea-3' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: ownDraft });
  });

  it('platform admin can see a non-draft idea without membership', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(submittedIdea);
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: submittedIdea });
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('platform admin still cannot see another author\'s draft (no admin bypass on drafts)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(othersDraft);
    const res = await handler(baseReq({ ideaId: 'idea-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: null });
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
