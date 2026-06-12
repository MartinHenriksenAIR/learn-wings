import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

// Idea owned by p1 (the caller), in draft.
const myDraft = { id: 'idea-1', org_id: 'org-1', user_id: 'p1', status: 'draft' };

describe('idea-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when ideaId is missing', async () => {
    const res = await handler(baseReq({ updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when ideaId is not a string', async () => {
    const res = await handler(baseReq({ ideaId: 7, updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when updates is missing', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when updates is an array', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: ['title'] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when updates has no whitelisted fields (only unknown keys)', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { status: 'approved', admin_notes: 'x' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid update fields provided' });
  });

  it('returns 400 when updates is empty', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: {} }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid update fields provided' });
  });

  it('returns 400 when a whitelisted string field is wrong type', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { pain_points: 42 } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'pain_points must be a string' });
  });

  it('returns 400 when tags is not an array of strings', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { tags: ['a', 2] } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns 400 when business_area is invalid', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { business_area: 'marketing' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'business_area must be one of: hr, finance, sales, support, ops, it, legal, other' });
  });

  it('returns 404 when idea not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // idea not found
    const res = await handler(baseReq({ ideaId: 'idea-999', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Idea not found' });
  });

  it('returns 403 when caller is not the author', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...myDraft, user_id: 'p2' }); // someone else's idea
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 for an org admin who is not the author (no admin bypass)', async () => {
    // org admin / platform admin do NOT get an author bypass here
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ ...myDraft, user_id: 'p2' }); // not the author
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 409 when idea is not in draft status', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...myDraft, status: 'submitted' });
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Only draft ideas can be edited' });
  });

  it('happy path: author updates own draft, SET only contains provided keys', async () => {
    mockQueryOne.mockResolvedValueOnce(myDraft); // load idea
    const updated = { ...myDraft, title: 'Updated', pain_points: 'slow' };
    mockQueryOne.mockResolvedValueOnce(updated); // UPDATE RETURNING
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { title: 'Updated', pain_points: 'slow' } }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: updated });

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE ideas');
    expect(sql).toContain('title');
    expect(sql).toContain('pain_points');
    // SET clause must NOT contain unrelated whitelisted columns
    expect(sql).not.toContain('description');
    expect(sql).not.toContain('business_area');
    expect(params).toContain('Updated');
    expect(params).toContain('slow');
    expect(params).toContain('idea-1');
  });

  it('ignores unknown keys but applies recognized ones', async () => {
    mockQueryOne.mockResolvedValueOnce(myDraft); // load idea
    mockQueryOne.mockResolvedValueOnce({ ...myDraft, title: 'New' }); // UPDATE RETURNING
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { title: 'New', status: 'approved', user_id: 'evil' } }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('title');
    expect(sql).not.toContain('status');
    expect(sql).not.toContain('user_id');
    expect(params).not.toContain('approved');
    expect(params).not.toContain('evil');
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ ideaId: 'idea-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
