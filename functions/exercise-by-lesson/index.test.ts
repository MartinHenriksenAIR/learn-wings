import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQueryOne: vi.fn(), mockGetProfile: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));

import handler from './index';
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') }, json: async () => body }) as any;

describe('exercise-by-lesson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    expect((await handler(baseReq({ lessonId: 'l1' }), {} as any)).status).toBe(401);
  });
  it('returns 400 when lessonId missing', async () => {
    expect((await handler(baseReq({}), {} as any)).status).toBe(400);
  });
  it('returns 403 when a non-member has no access', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // access check
    expect((await handler(baseReq({ lessonId: 'l1' }), {} as any)).status).toBe(403);
  });
  it('returns the FULL config (answers included) for an entitled learner', async () => {
    const ex = { id: 'ex1', lesson_id: 'l1', exercise_kind: 'bucket_sort',
      config: { version: 1, buckets: [{ id: 'b1', label: 'X' }], items: [{ id: 'i1', text: 't', bucketId: 'b1' }] } };
    mockQueryOne
      .mockResolvedValueOnce({ ok: true }) // access check
      .mockResolvedValueOnce(ex);           // exercise fetch
    const res = await handler(baseReq({ lessonId: 'l1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).exercise.config.items[0].bucketId).toBe('b1'); // answer present
  });
  it('platform admin skips the access check', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'admin', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ id: 'ex1', lesson_id: 'l1', exercise_kind: 'quick_check', config: { version: 1, questions: [] } });
    expect((await handler(baseReq({ lessonId: 'l1' }), {} as any)).status).toBe(200);
  });
});
