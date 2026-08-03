import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(),
    mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('touch-course', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
  });

  it('stamps the caller enrollment and returns success', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c1' }), {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // SECURITY PIN: the UPDATE must scope to profile.id ('p1'), never a client-supplied user id.
    const updateCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('UPDATE enrollments'));
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain('last_accessed_at = now()');
    expect(updateCall![1]).toEqual(['p1', 'org-1', 'c1']);
  });

  it('returns 400 when orgId is missing (and does not touch the DB)', async () => {
    const res = await handler(baseReq({ courseId: 'c1' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when courseId is missing (and does not touch the DB)', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 401 when getProfile returns null', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 for a non-member and does not touch the DB', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');

    const updateCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('UPDATE enrollments'));
    expect(updateCall).toBeUndefined();
  });

  it('returns 500 on database error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c1' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
  });
});
