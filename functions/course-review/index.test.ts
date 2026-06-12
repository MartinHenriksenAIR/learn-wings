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

describe('course-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
  });

  // 1. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 5 }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 5 }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 orgId missing
  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ courseId: 'c-1', rating: 5 }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  // 4. 400 courseId missing
  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', rating: 5 }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  // 5. 400 invalid ratings — 0, 6, 2.5, and '3' (string)
  it.each([
    [0],
    [6],
    [2.5],
    ['3'],
  ])('returns 400 for invalid rating %s', async (invalidRating) => {
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: invalidRating }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'rating must be an integer between 1 and 5' });
  });

  // 6. 400 comment longer than 1000 chars
  it('returns 400 when comment exceeds 1000 characters', async () => {
    const longComment = 'a'.repeat(1001);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 4, comment: longComment }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'comment must be at most 1000 characters' });
  });

  // 6b. 400 comment present but not a string
  it('returns 400 when comment is not a string', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 4, comment: 42 }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'comment must be a string' });
  });

  // 7. 403 non-member — isActiveMember called with ('p1','org-1'); no INSERT ran
  it('returns 403 for non-member and does not call INSERT', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 5 }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');

    const insertCall = mockQueryOne.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT'),
    );
    expect(insertCall).toBeUndefined();
  });

  // 8. Happy path insert
  it('returns 200 with review on success (security: user_id = profile.id from token)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    const reviewRow = {
      id: 'r-1', org_id: 'org-1', user_id: 'p1', course_id: 'c-1',
      rating: 5, comment: 'Great course',
      created_at: '2024-01-10T00:00:00Z', updated_at: '2024-01-10T00:00:00Z',
    };
    mockQueryOne.mockResolvedValueOnce(reviewRow);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 5, comment: 'Great course' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ review: reviewRow });

    const [insertSql, insertParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(insertSql).toContain('ON CONFLICT (org_id, user_id, course_id)');
    expect(insertSql).toContain('DO UPDATE SET');
    expect(insertSql).toContain('updated_at = NOW()');
    expect(insertSql).toContain('RETURNING');

    // SECURITY PIN: params exactly ['org-1','p1','c-1',5,'Great course']
    expect(insertParams).toEqual(['org-1', 'p1', 'c-1', 5, 'Great course']);
  });

  // 9. userId in body is IGNORED
  it('ignores userId in body — params still use token-derived profile id', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    const reviewRow = {
      id: 'r-1', org_id: 'org-1', user_id: 'p1', course_id: 'c-1',
      rating: 5, comment: null,
      created_at: '2024-01-10T00:00:00Z', updated_at: '2024-01-10T00:00:00Z',
    };
    mockQueryOne.mockResolvedValueOnce(reviewRow);

    const res = await handler(
      baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 5, userId: 'evil' }),
      {} as any,
    );

    expect(res.status).toBe(200);
    const [, insertParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    // user_id at position 2 is 'p1', not 'evil'
    expect(insertParams[1]).toBe('p1');
    // 'evil' must not appear anywhere in params
    expect(insertParams).not.toContain('evil');
  });

  // 10. Comment normalization: whitespace-only → null
  it('normalizes whitespace-only comment to null', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({
      id: 'r-1', org_id: 'org-1', user_id: 'p1', course_id: 'c-1',
      rating: 3, comment: null,
      created_at: '2024-01-10T00:00:00Z', updated_at: '2024-01-10T00:00:00Z',
    });

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 3, comment: '   ' }), {} as any);

    expect(res.status).toBe(200);
    const [, insertParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    // position 5 (index 4) is the comment — must be null
    expect(insertParams[4]).toBeNull();
  });

  // 11. Platform-admin bypass — isActiveMember NOT called
  it('platform admin: bypasses isActiveMember check and returns 200', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({
      id: 'r-1', org_id: 'org-1', user_id: 'p1', course_id: 'c-1',
      rating: 5, comment: null,
      created_at: '2024-01-10T00:00:00Z', updated_at: '2024-01-10T00:00:00Z',
    });

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 5 }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  // 12. 500 db error
  it('returns 500 on db error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1', rating: 4 }), {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
