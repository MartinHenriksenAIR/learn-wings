import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', email: 'admin@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

const makeReq = (body: object) => ({
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => body,
});

describe('delete-user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-admin users', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'requester-uuid', is_platform_admin: false });

    const res = await handler(makeReq({ userId: 'target-uuid' }) as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns 400 when admin tries to delete their own account', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'requester-uuid', is_platform_admin: true });

    const res = await handler(makeReq({ userId: 'requester-uuid' }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/own account/i);
  });

  it('deletes the target profile and returns success', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'requester-uuid', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]); // DELETE

    const res = await handler(makeReq({ userId: 'target-uuid' }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const deleteCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('DELETE'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toContain('target-uuid');
  });
});
