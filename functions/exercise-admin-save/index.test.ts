import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockWithTransaction, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockWithTransaction: vi.fn(), mockGetProfile: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: mockWithTransaction, getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const validBody = {
  lessonId: 'lesson-1',
  exerciseKind: 'bucket_sort',
  config: { version: 1, buckets: [{ id: 'b1', label: 'X' }, { id: 'b2', label: 'Y' }], items: [{ id: 'i1', text: 't', bucketId: 'b1' }] },
};

describe('exercise-admin-save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 403 for a non-admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'u1', is_platform_admin: false });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
  });

  it('returns 400 when lessonId is missing', async () => {
    const res = await handler(baseReq({ ...validBody, lessonId: undefined }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 on an unknown exerciseKind', async () => {
    const res = await handler(baseReq({ ...validBody, exerciseKind: 'mystery' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/unknown exercise_kind/i);
  });

  it('returns 400 on malformed config', async () => {
    const res = await handler(baseReq({ ...validBody, config: { version: 1, buckets: [], items: [] } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('upserts and returns the saved exercise on the happy path', async () => {
    const saved = { id: 'ex-1', lesson_id: 'lesson-1', exercise_kind: 'bucket_sort', config: validBody.config };
    mockWithTransaction.mockImplementation(async (fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [saved] }) }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).exercise).toEqual(saved);
  });
});
