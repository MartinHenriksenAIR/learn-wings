import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('enroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
  });

  // 1. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 orgId missing
  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  // 4. 400 courseId missing
  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  // 5. 403 non-member — isActiveMember called with ('p1','org-1'); no INSERT should run
  it('returns 403 for non-member and does not call INSERT', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
    // No queryOne call containing INSERT should have been made
    const insertCall = mockQueryOne.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT'),
    );
    expect(insertCall).toBeUndefined();
  });

  // 6. 403 course unavailable — member; availability EXISTS returns {ok:false}; no INSERT
  it('returns 403 when course is not available for the org', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // availability check

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course not available for this organization' });

    // Assert availability query params
    const [, availParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(availParams).toEqual(['org-1', 'c-1']);

    // Assert no INSERT ran
    const insertCall = mockQueryOne.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT'),
    );
    expect(insertCall).toBeUndefined();
  });

  // 7. Happy path — member; availability ok; INSERT returns new row → 200 {enrollment}
  it('returns 200 with enrollment on success (security: user_id = profile.id from token)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne
      .mockResolvedValueOnce({ ok: true }) // availability
      .mockResolvedValueOnce({             // INSERT RETURNING
        id: 'e-new', org_id: 'org-1', user_id: 'p1', course_id: 'c-1',
        status: 'enrolled', enrolled_at: '2024-01-10T00:00:00Z', completed_at: null,
      });

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.enrollment).toMatchObject({ id: 'e-new', user_id: 'p1', status: 'enrolled' });

    // Assert INSERT SQL shape
    const [insertSql, insertParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(insertSql).toContain('ON CONFLICT (org_id, user_id, course_id) DO NOTHING');
    expect(insertSql).toContain('RETURNING');

    // SECURITY PIN: user_id at position 2 must be profile.id from token, not from body
    expect(insertParams).toEqual(['org-1', 'p1', 'c-1']);
  });

  // 8. 409 already enrolled — INSERT queryOne returns null
  it('returns 409 when already enrolled (INSERT conflict returns null)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne
      .mockResolvedValueOnce({ ok: true }) // availability
      .mockResolvedValueOnce(null);        // INSERT returns null (conflict)

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Already enrolled' });
  });

  // 9. Platform-admin bypasses membership check but availability EXISTS still queried
  it('platform admin: skips isActiveMember but still checks course availability', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne
      .mockResolvedValueOnce({ ok: true }) // availability
      .mockResolvedValueOnce({
        id: 'e-admin', org_id: 'org-1', user_id: 'p1', course_id: 'c-1',
        status: 'enrolled', enrolled_at: '2024-01-10T00:00:00Z', completed_at: null,
      });

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();

    // Availability was still checked
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    const [availSql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(availSql).toContain('is_published = TRUE');
  });

  // 10. 500 db error
  it('returns 500 on db error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
