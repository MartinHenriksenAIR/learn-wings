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

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ orgId: 'org-1', lessonId: 'lesson-1', status: 'completed' }),
};

describe('lesson-progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
  });

  it('upserts lesson progress and returns success', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValue([]);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const upsertCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('lesson_progress'));
    expect(upsertCall).toBeDefined();
    expect(upsertCall![1]).toEqual(['org-1', 'p1', 'lesson-1', 'completed']);
  });

  it('stamps the enrollment last_accessed_at for the lesson course, scoped to profile.id', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValue([]);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);

    const touchCall = mockQuery.mock.calls.find(
      c => (c[0] as string).includes('UPDATE enrollments'),
    );
    expect(touchCall).toBeDefined();
    expect(touchCall![0]).toContain('last_accessed_at = now()');
    expect(touchCall![1]).toEqual(['p1', 'org-1', 'lesson-1']);
  });

  it('still returns 200 when the last_accessed_at stamp fails (best-effort)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery
      .mockResolvedValueOnce([])                        // lesson_progress upsert
      .mockRejectedValueOnce(new Error('stamp boom'));  // enrollments last_accessed_at stamp
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true });
    const upsertCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('lesson_progress'));
    expect(upsertCall![1]).toEqual(['org-1', 'p1', 'lesson-1', 'completed']);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('returns 401 when getProfile returns null', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 for non-member and does not upsert progress', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');

    const upsertCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('lesson_progress'));
    expect(upsertCall).toBeUndefined();
  });

  it('returns 500 on database error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    const res = await handler(baseReq as any, { error: vi.fn() } as any);

    expect(res.status).toBe(500);
  });
});
