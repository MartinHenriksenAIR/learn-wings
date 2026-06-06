import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

// idea loaded by the handler: authored by p2, in org-1
const ideaRow = { id: 'idea-1', org_id: 'org-1', user_id: 'p2', status: 'submitted' };

const VALID_STATUSES =
  'draft, submitted, under_review, in_review, approved, accepted, rejected, in_progress, completed, done, archived';

describe('idea-status-update', () => {
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
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'approved' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'approved' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when ideaId is missing', async () => {
    const res = await handler(baseReq({ status: 'approved' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when ideaId is not a string', async () => {
    const res = await handler(baseReq({ ideaId: 123, status: 'approved' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when status is missing', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: `status must be one of: ${VALID_STATUSES}` });
  });

  it('returns 400 when status is invalid', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'frozen' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: `status must be one of: ${VALID_STATUSES}` });
  });

  it('returns 400 when adminNotes is the wrong type', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'approved', adminNotes: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'adminNotes must be a string or null' });
  });

  it('returns 400 when rejectionReason is the wrong type', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'rejected', rejectionReason: {} }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'rejectionReason must be a string or null' });
  });

  it('returns 404 when idea not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ ideaId: 'idea-999', status: 'approved' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Idea not found' });
  });

  it('returns 403 when a plain member tries to update status', async () => {
    mockQueryOne.mockResolvedValueOnce(ideaRow); // load
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'approved' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when the idea AUTHOR (not admin) tries to update status', async () => {
    // caller p1 authored the idea, but is neither platform nor org admin → authorship grants nothing here
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, user_id: 'p1' });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'approved' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('happy path: org admin updates status (isOrgAdmin called with the idea row org_id)', async () => {
    mockQueryOne.mockResolvedValueOnce(ideaRow); // load
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { ...ideaRow, status: 'approved' };
    mockQueryOne.mockResolvedValueOnce(updated); // UPDATE RETURNING
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'approved' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: updated });

    // authz used the loaded idea's org_id, never client-supplied
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE ideas');
    expect(sql).toContain('status =');
    expect(params).toContain('approved');
    expect(params).toContain('idea-1');
  });

  it('org admin may status-update a draft idea', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, status: 'draft' }); // draft load
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { ...ideaRow, status: 'under_review' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'under_review' }), {} as any);
    expect(res.status).toBe(200);
  });

  it('happy path: platform admin updates status without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow); // load
    const updated = { ...ideaRow, status: 'approved' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'approved' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('omits admin_notes from the SET when adminNotes is absent', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow); // load
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, status: 'approved' });
    await handler(baseReq({ ideaId: 'idea-1', status: 'approved' }), {} as any);
    const [sql] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).not.toContain('admin_notes =');
  });

  it('sets admin_notes to null when adminNotes is explicit null', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow); // load
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, status: 'approved', admin_notes: null });
    await handler(baseReq({ ideaId: 'idea-1', status: 'approved', adminNotes: null }), {} as any);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('admin_notes =');
    expect(params).toContain(null);
  });

  it('sets admin_notes to the supplied string when adminNotes is provided', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow); // load
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, status: 'approved' });
    await handler(baseReq({ ideaId: 'idea-1', status: 'approved', adminNotes: 'looks good' }), {} as any);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('admin_notes =');
    expect(params).toContain('looks good');
  });

  it("sets rejection_reason when status is 'rejected' and a reason is supplied", async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow); // load
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, status: 'rejected' });
    await handler(baseReq({ ideaId: 'idea-1', status: 'rejected', rejectionReason: 'duplicate' }), {} as any);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('rejection_reason =');
    expect(params).toContain('duplicate');
  });

  it("forces rejection_reason to null when status is not 'rejected' even if a reason is supplied", async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow); // load
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, status: 'approved' });
    await handler(baseReq({ ideaId: 'idea-1', status: 'approved', rejectionReason: 'ignored' }), {} as any);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('rejection_reason =');
    // the supplied reason must NOT make it into params; rejection_reason is forced null
    expect(params).not.toContain('ignored');
    expect(params).toContain(null);
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ ideaId: 'idea-1', status: 'approved' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
