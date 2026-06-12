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

const orgReport = { org_id: 'org-1' };
const globalReport = { org_id: null };

describe('community-report-update', () => {
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
    const res = await handler(baseReq({ reportId: 'r1', status: 'reviewed' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ reportId: 'r1', status: 'reviewed' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when reportId is missing', async () => {
    const res = await handler(baseReq({ status: 'reviewed' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'reportId is required' });
  });

  it('returns 400 when reportId is not a string', async () => {
    const res = await handler(baseReq({ reportId: 123, status: 'reviewed' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'reportId is required' });
  });

  it('returns 400 when status is an invalid value', async () => {
    const res = await handler(baseReq({ reportId: 'r1', status: 'pending' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "status must be 'reviewed' or 'dismissed'" });
  });

  it('returns 400 when adminNotes is not a string or null', async () => {
    const res = await handler(baseReq({ reportId: 'r1', adminNotes: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'adminNotes must be a string or null' });
  });

  it('returns 400 when neither status nor adminNotes is provided', async () => {
    const res = await handler(baseReq({ reportId: 'r1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Provide status or adminNotes to update' });
  });

  it('returns 404 when report not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // report not found
    const res = await handler(baseReq({ reportId: 'r-999', status: 'reviewed' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Report not found' });
  });

  // Global report — non-platform-admin → 403
  it('returns 403 when non-admin tries to update a global report', async () => {
    mockQueryOne.mockResolvedValueOnce(globalReport);
    const res = await handler(baseReq({ reportId: 'r1', status: 'reviewed' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // Org report — org admin of different org → 403
  it('returns 403 when org admin of a different org tries to update', async () => {
    mockQueryOne.mockResolvedValueOnce(orgReport); // org_id = 'org-1'
    mockIsOrgAdmin.mockResolvedValueOnce(false); // not admin of org-1
    const res = await handler(baseReq({ reportId: 'r1', status: 'reviewed' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // Happy path: org admin updates status only
  it('happy path: org admin updates status', async () => {
    mockQueryOne.mockResolvedValueOnce(orgReport); // report loaded
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { id: 'r1', status: 'reviewed', reviewed_by: 'p1', org_id: 'org-1' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ reportId: 'r1', status: 'reviewed' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ report: updated });

    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql, params] = updateCall;
    expect(sql).toContain('UPDATE community_reports');
    expect(sql).toContain('status = $1');
    expect(sql).toContain('reviewed_by = $2'); // server-set from profile
    expect(sql).toContain('reviewed_at = now()');
    expect(sql).toContain('WHERE id = $3');
    expect(params).toEqual(['reviewed', 'p1', 'r1']); // exact placeholder order
  });

  // Happy path: update adminNotes only
  it('happy path: updates adminNotes only (reviewed_by and reviewed_at still set)', async () => {
    mockQueryOne.mockResolvedValueOnce(orgReport);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { id: 'r1', admin_notes: 'Checked', reviewed_by: 'p1', org_id: 'org-1' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ reportId: 'r1', adminNotes: 'Checked' }), {} as any);
    expect(res.status).toBe(200);

    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql, params] = updateCall;
    expect(sql).toContain('admin_notes = $1');
    expect(sql).not.toContain('status =');
    expect(sql).toContain('reviewed_by = $2');
    expect(sql).toContain('reviewed_at = now()');
    expect(sql).toContain('WHERE id = $3');
    expect(params).toEqual(['Checked', 'p1', 'r1']); // exact placeholder order
  });

  // Happy path: update both status and adminNotes
  it('happy path: updates both status and adminNotes', async () => {
    mockQueryOne.mockResolvedValueOnce(orgReport);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { id: 'r1', status: 'dismissed', admin_notes: 'Not valid', reviewed_by: 'p1' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ reportId: 'r1', status: 'dismissed', adminNotes: 'Not valid' }), {} as any);
    expect(res.status).toBe(200);

    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql, params] = updateCall;
    expect(sql).toContain('status = $1');
    expect(sql).toContain('admin_notes = $2');
    expect(sql).toContain('reviewed_by = $3');
    expect(sql).toContain('WHERE id = $4');
    expect(params).toEqual(['dismissed', 'Not valid', 'p1', 'r1']); // exact placeholder order
  });

  // adminNotes can be null (set to null explicitly)
  it('happy path: adminNotes can be set to null', async () => {
    mockQueryOne.mockResolvedValueOnce(orgReport);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { id: 'r1', admin_notes: null, reviewed_by: 'p1' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ reportId: 'r1', adminNotes: null }), {} as any);
    expect(res.status).toBe(200);
    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(updateCall[1]).toEqual([null, 'p1', 'r1']); // exact placeholder order
  });

  // Platform admin bypasses isOrgAdmin
  it('platform admin can update any report without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(orgReport);
    const updated = { id: 'r1', status: 'reviewed', reviewed_by: 'p1' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ reportId: 'r1', status: 'reviewed' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ reportId: 'r1', status: 'reviewed' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
