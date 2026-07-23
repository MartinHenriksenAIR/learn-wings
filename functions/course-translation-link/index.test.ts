import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsUniqueViolation } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsUniqueViolation: vi.fn(() => false),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, isUniqueViolation: mockIsUniqueViolation }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isOrgAdmin: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('course-translation-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsUniqueViolation.mockReturnValue(false);
  });

  it('returns 403 for a non-platform-admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ action: 'unlink', courseId: 'c1' }), {} as any);
    expect(res.status).toBe(403);
  });

  it('returns 400 for an unknown action', async () => {
    const res = await handler(baseReq({ action: 'merge', courseId: 'c1' }), {} as any);
    expect(res.status).toBe(400);
  });

  it('links a standalone candidate into a standalone course (mints one group id for both)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-da', language: 'da', course_group_id: null }) // course
      .mockResolvedValueOnce({ id: 'c-en', language: 'en', course_group_id: null }); // other
    mockQuery.mockResolvedValueOnce([]); // UPDATE

    const res = await handler(baseReq({ action: 'link', courseId: 'c-da', otherCourseId: 'c-en' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    const updateSql = mockQuery.mock.calls[0][0] as string;
    expect(updateSql).toContain('gen_random_uuid()');
  });

  it('rejects linking a candidate that already belongs to a group (409)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-da', language: 'da', course_group_id: null })
      .mockResolvedValueOnce({ id: 'c-en', language: 'en', course_group_id: 'g-existing' });

    const res = await handler(baseReq({ action: 'link', courseId: 'c-da', otherCourseId: 'c-en' }), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).error).toMatch(/already linked/i);
  });

  it('rejects a same-language edition already in the group (409)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-da', language: 'da', course_group_id: 'g1' })
      .mockResolvedValueOnce({ id: 'c-da2', language: 'da', course_group_id: null })
      .mockResolvedValueOnce({ conflict: true }); // a da edition already in g1

    const res = await handler(baseReq({ action: 'link', courseId: 'c-da', otherCourseId: 'c-da2' }), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).error).toMatch(/edition already exists/i);
  });

  it('returns 400 when a course to link has no language set', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-da', language: 'da', course_group_id: null })
      .mockResolvedValueOnce({ id: 'c-x', language: null, course_group_id: null });

    const res = await handler(baseReq({ action: 'link', courseId: 'c-da', otherCourseId: 'c-x' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/language/i);
  });

  it('unlinks a course and collapses a leftover group-of-one', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-en', course_group_id: 'g1' }) // load course
      .mockResolvedValueOnce({ remaining: 1 });                     // remaining count after clearing
    mockQuery
      .mockResolvedValueOnce([])  // clear the unlinked course
      .mockResolvedValueOnce([]); // collapse the leftover single edition

    const res = await handler(baseReq({ action: 'unlink', courseId: 'c-en' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('unlink on an already-standalone course is a no-op success', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'c1', course_group_id: null });
    const res = await handler(baseReq({ action: 'unlink', courseId: 'c1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
