import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const validBody = { courseId: 'c1' };

describe('course-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 for non-platform-admin', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when courseId is empty string', async () => {
    const res = await handler(baseReq({ courseId: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when courseId is not a string', async () => {
    const res = await handler(baseReq({ courseId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 404 when course not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course not found' });
  });

  it('happy path: deletes course and returns success', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'c1' });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true });

    // Verify SQL
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM courses');
    expect(sql).toContain('RETURNING id');
    expect(params[0]).toBe('c1');
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'db connection failed' });
  });
});
