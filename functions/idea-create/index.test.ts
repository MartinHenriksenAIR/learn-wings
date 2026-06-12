import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const validBody = {
  orgId: 'org-1',
  title: 'My Idea',
};

describe('idea-create', () => {
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
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ title: 'x' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when orgId is not a string', async () => {
    const res = await handler(baseReq({ orgId: 123, title: 'x' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when title is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when title is an empty string', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', title: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when title is not a string', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', title: 5 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when a string field is wrong type', async () => {
    const res = await handler(baseReq({ ...validBody, pain_points: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'pain_points must be a string' });
  });

  it('accepts null for an optional string field', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'idea-1' });
    const res = await handler(baseReq({ ...validBody, description: null }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 400 when tags is not an array of strings', async () => {
    const res = await handler(baseReq({ ...validBody, tags: ['a', 1] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns 400 when business_area is not a valid enum value', async () => {
    const res = await handler(baseReq({ ...validBody, business_area: 'marketing' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'business_area must be one of: hr, finance, sales, support, ops, it, legal, other' });
  });

  it('accepts null for business_area', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'idea-1' });
    const res = await handler(baseReq({ ...validBody, business_area: null }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 403 when caller is not an active member of the org', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('happy path: creates idea for active member, server-sets user_id and status=draft', async () => {
    const newIdea = { id: 'idea-new', org_id: 'org-1', user_id: 'p1', title: 'My Idea', status: 'draft' };
    mockQueryOne.mockResolvedValueOnce(newIdea);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: newIdea });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO ideas');
    expect(sql).toContain('RETURNING *');
    expect(params).toContain('p1'); // profile.id server-set as user_id
    expect(params).toContain('org-1'); // orgId
    expect(params).toContain('draft'); // status always draft
  });

  it('ignores client-supplied user_id and status overrides', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'idea-new' });
    await handler(baseReq({ ...validBody, user_id: 'evil-p', status: 'approved' }), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).not.toContain('evil-p');
    expect(params).not.toContain('approved');
    expect(params).toContain('p1'); // server-set user_id
    expect(params).toContain('draft'); // server-set status
  });

  it('ignores non-whitelisted body keys (admin_notes, category_id, submitted_at)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'idea-new' });
    await handler(baseReq({
      ...validBody,
      admin_notes: 'sneaky',
      category_id: 'cat-x',
      rejection_reason: 'nope',
      submitted_at: '2020-01-01',
    }), {} as any);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).not.toContain('sneaky');
    expect(params).not.toContain('cat-x');
    expect(params).not.toContain('nope');
    expect(params).not.toContain('2020-01-01');
    expect(sql).not.toContain('admin_notes');
    expect(sql).not.toContain('category_id');
  });

  it('platform admin can create without active membership', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ id: 'idea-new' });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('passes whitelisted optional fields through to INSERT', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'idea-new' });
    await handler(baseReq({ ...validBody, pain_points: 'too slow', business_area: 'finance', tags: ['a', 'b'] }), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('too slow');
    expect(params).toContain('finance');
    expect(params).toContainEqual(['a', 'b']);
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
