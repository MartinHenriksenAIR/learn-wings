import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

// idea authored by p2 in org-1
const othersIdea = { id: 'idea-1', org_id: 'org-1', user_id: 'p2' };
// idea authored by caller p1
const myIdea = { ...othersIdea, user_id: 'p1' };

describe('idea-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
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

  it('returns 404 when idea not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ ideaId: 'idea-999' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Idea not found' });
  });

  it('returns 403 when a non-author plain member tries to delete', async () => {
    mockQueryOne.mockResolvedValueOnce(othersIdea);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('happy path: author (not admin) deletes their own idea', async () => {
    mockQueryOne.mockResolvedValueOnce(myIdea); // load
    // isOrgAdmin may be consulted and return false (beforeEach default); author check must still pass.
    // Do NOT queue a mockResolvedValueOnce here: the author short-circuit skips the isOrgAdmin call,
    // leaving a once-value in the queue that vi.clearAllMocks() does NOT drain — it would then leak
    // into the next test and wrongly deny the org admin.
    mockQuery.mockResolvedValueOnce([]); // DELETE

    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM ideas');
    expect(params).toEqual(['idea-1']);
  });

  it('happy path: org admin (not author) deletes an idea in their org', async () => {
    mockQueryOne.mockResolvedValueOnce(othersIdea); // load
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]); // DELETE
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('happy path: platform admin deletes any idea without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(othersIdea); // load
    mockQuery.mockResolvedValueOnce([]); // DELETE
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
