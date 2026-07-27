import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQueryOne: vi.fn(), mockGetProfile: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne, getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') }, json: async () => body }) as any;

describe('exercise-admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'admin-1', is_platform_admin: true });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any, {} as any);
    expect(res.status).toBe(204);
  });
  it('returns 403 for a non-admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'u1', is_platform_admin: false });
    expect((await handler(baseReq({ lessonId: 'l1' }), {} as any)).status).toBe(403);
  });
  it('returns 400 when lessonId is missing', async () => {
    expect((await handler(baseReq({}), {} as any)).status).toBe(400);
  });
  it('returns {exercise:null} when none exists', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ lessonId: 'l1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ exercise: null });
  });
  it('returns the exercise when present', async () => {
    const ex = { id: 'ex1', lesson_id: 'l1', exercise_kind: 'quick_check', config: { version: 1, questions: [] } };
    mockQueryOne.mockResolvedValueOnce(ex);
    const res = await handler(baseReq({ lessonId: 'l1' }), {} as any);
    expect(JSON.parse(res.body as string)).toEqual({ exercise: ex });
  });
});
