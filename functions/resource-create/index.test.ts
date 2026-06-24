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
  title: 'My Resource',
  resource_type: 'link',
};

describe('resource-create', () => {
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

  it('returns 400 when title is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when title is empty string', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', title: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when description is wrong type', async () => {
    const res = await handler(baseReq({ ...validBody, description: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'description must be a string' });
  });

  it('accepts null for optional description', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'r1' });
    const res = await handler(baseReq({ ...validBody, description: null }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 400 when resource_type is invalid', async () => {
    const res = await handler(baseReq({ ...validBody, resource_type: 'video' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'resource_type must be one of: link, document, template, guide',
    });
  });

  it('defaults resource_type to "link" when omitted', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'r1' });
    const { resource_type: _omit, ...noType } = validBody;
    await handler(baseReq(noType), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('link');
  });

  it('returns 400 when tags is not an array of strings', async () => {
    const res = await handler(baseReq({ ...validBody, tags: ['a', 1] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns 403 when caller is not an active member', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('happy path: creates resource, server-sets user_id, embeds profile', async () => {
    const newResource = {
      id: 'r-new',
      org_id: 'org-1',
      user_id: 'p1',
      title: 'My Resource',
      resource_type: 'link',
      profile: { id: 'p1', full_name: 'Alice', department: null },
    };
    mockQueryOne.mockResolvedValueOnce(newResource);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ resource: newResource });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO community_resources');
    expect(sql).toContain('LEFT JOIN profiles');
    expect(params).toContain('p1'); // server-set user_id
    expect(params).toContain('org-1');
    expect(params).toContain('My Resource');
    expect(params).toContain('link');
  });

  it('ignores client-supplied user_id (server derives it)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'r-new' });
    await handler(baseReq({ ...validBody, user_id: 'evil-p' }), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).not.toContain('evil-p');
    expect(params).toContain('p1');
  });

  it('platform admin can create without active membership', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ id: 'r-new' });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('passes optional url + tags through to INSERT', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'r-new' });
    await handler(baseReq({ ...validBody, url: 'https://example.com', tags: ['ai', 'tooling'] }), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('https://example.com');
    expect(params).toContainEqual(['ai', 'tooling']);
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
