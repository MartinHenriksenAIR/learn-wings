import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

// idea in org-1, owned by p2 (not the caller)
const submittedIdea = {
  id: 'idea-1',
  org_id: 'org-1',
  user_id: 'p2',
  status: 'submitted',
};

// draft owned by p2 (not the caller)
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

describe('idea-vote', () => {
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
    const res = await handler(baseReq({ ideaId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 404 when idea is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // idea load → null
    const res = await handler(baseReq({ ideaId: 'idea-999' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Idea not found' });
  });

  it('returns 404 for another author\'s draft (no admin bypass)', async () => {
    mockQueryOne.mockResolvedValueOnce(othersDraft); // idea load
    const res = await handler(baseReq({ ideaId: 'idea-2' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Idea not found' });
  });

  it('returns 404 for another author\'s draft even when caller is platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(othersDraft); // idea load
    const res = await handler(baseReq({ ideaId: 'idea-2' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Idea not found' });
  });

  it('allows voting on own draft', async () => {
    mockQueryOne.mockResolvedValueOnce(ownDraft); // idea load
    mockIsActiveMember.mockResolvedValueOnce(true); // member check
    mockQueryOne.mockResolvedValueOnce({ id: 'vote-1' }); // INSERT returning
    const res = await handler(baseReq({ ideaId: 'idea-3' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
  });

  it('returns 403 when caller is not a member of the idea org', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(false); // not a member
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('happy path: member votes and INSERT uses org_id from the loaded row', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(true); // member
    mockQueryOne.mockResolvedValueOnce({ id: 'vote-new' }); // INSERT
    // Send a bogus orgId in the body — it must never reach INSERT params
    const res = await handler(baseReq({ ideaId: 'idea-1', orgId: 'bogus-org' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });

    // Verify INSERT params: [ideaId, org-from-row, profile.id]
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO idea_votes');
    expect(params).toEqual(['idea-1', 'org-1', 'p1']); // org from loaded row, not client
    expect(params).not.toContain('bogus-org');
  });

  it('returns 409 on duplicate vote (23505 unique violation)', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(true); // member
    const dupError = Object.assign(new Error('duplicate'), { code: '23505' });
    mockQueryOne.mockRejectedValueOnce(dupError); // INSERT → 23505
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'You have already voted for this idea.' });
  });

  it('platform admin bypasses membership check and can vote', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockQueryOne.mockResolvedValueOnce({ id: 'vote-new' }); // INSERT
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('returns 500 on non-23505 insert error (rethrows)', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(true); // member
    const dbError = new Error('connection refused');
    mockQueryOne.mockRejectedValueOnce(dbError); // INSERT → non-23505
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });

  it('returns 500 on idea load error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db unreachable'));
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'db unreachable' });
  });
});
