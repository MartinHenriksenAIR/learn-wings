import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('community-report-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockQueryOne.mockResolvedValue(null); // default: no existing report, then return inserted report
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: 'spam' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: 'spam' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when targetType is invalid', async () => {
    const res = await handler(baseReq({ targetType: 'user', targetId: 't1', reason: 'spam' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "targetType must be 'post' or 'comment'" });
  });

  it('returns 400 when targetType is missing', async () => {
    const res = await handler(baseReq({ targetId: 't1', reason: 'spam' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "targetType must be 'post' or 'comment'" });
  });

  it('returns 400 when targetId is missing', async () => {
    const res = await handler(baseReq({ targetType: 'post', reason: 'spam' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'targetId is required' });
  });

  it('returns 400 when targetId is not a string', async () => {
    const res = await handler(baseReq({ targetType: 'post', targetId: 123, reason: 'spam' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'targetId is required' });
  });

  it('returns 400 when reason is missing', async () => {
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'reason is required' });
  });

  it('returns 400 when reason is empty string', async () => {
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'reason is required' });
  });

  it('returns 400 when reason is not a string', async () => {
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'reason is required' });
  });

  it('returns 400 when orgId is present but not a string or null', async () => {
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: 'spam', orgId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId must be a string or null' });
  });

  it('allows orgId to be null', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no existing report
    const report = { id: 'r1', reporter_user_id: 'p1', target_type: 'post', target_id: 't1', org_id: null, reason: 'spam' };
    mockQueryOne.mockResolvedValueOnce(report);
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: 'spam', orgId: null }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 409 when report already exists (dedupe check)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'existing-r1' }); // existing report found
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: 'spam' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'You have already reported this content.' });
  });

  it('returns 409 on 23505 unique violation race (TOCTOU backstop)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no existing report
    const pgError = Object.assign(new Error('duplicate key'), { code: '23505' });
    mockQueryOne.mockRejectedValueOnce(pgError);
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: 'spam' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'You have already reported this content.' });
  });

  it('happy path: reporter_user_id is server-set from profile (not body)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no existing report
    const report = { id: 'r1', reporter_user_id: 'p1', target_type: 'post', target_id: 't1', org_id: 'org-1', reason: 'spam' };
    mockQueryOne.mockResolvedValueOnce(report);
    const res = await handler(
      baseReq({ targetType: 'post', targetId: 't1', reason: 'spam', orgId: 'org-1' }),
      {} as any,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ report });

    // Verify dedupe check params
    const dedupeCall = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(dedupeCall[1]).toContain('p1'); // reporter from profile, not body

    // Verify INSERT params — reporter_user_id from profile.id
    const insertCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(insertCall[0]).toContain('INSERT INTO community_reports');
    expect(insertCall[1]).toContain('p1');
    expect(insertCall[1]).toContain('post');
    expect(insertCall[1]).toContain('t1');
    expect(insertCall[1]).toContain('org-1');
    expect(insertCall[1]).toContain('spam');
  });

  it('happy path: comment targetType accepted', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const report = { id: 'r2', target_type: 'comment', target_id: 'c1', reason: 'abuse' };
    mockQueryOne.mockResolvedValueOnce(report);
    const res = await handler(baseReq({ targetType: 'comment', targetId: 'c1', reason: 'abuse' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ report });
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ targetType: 'post', targetId: 't1', reason: 'spam' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
