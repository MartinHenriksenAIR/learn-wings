import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'admin-uuid', email: 'admin@contoso.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

const baseReq = (body: object) => ({
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => body,
});

describe('admin-user-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 if requesting user is not a platform admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false });

    const res = await handler(baseReq({ action: 'toggle-platform-admin', target_user_id: 'some-uuid', value: true }) as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('toggles platform admin status when requested by a platform admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true }); // admin check
    mockQuery.mockResolvedValueOnce([]);                              // UPDATE profiles

    const res = await handler(baseReq({ action: 'toggle-platform-admin', target_user_id: 'target-uuid', value: true }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const updateCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('UPDATE profiles'));
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain('target-uuid');
  });

  it('removes a membership when action is remove-membership', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true }); // admin check
    mockQuery.mockResolvedValueOnce([]);                              // DELETE

    const res = await handler(baseReq({ action: 'remove-membership', membership_id: 'mem-uuid' }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const deleteCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('DELETE'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toContain('mem-uuid');
  });

  it('returns 400 for an unknown action', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });

    const res = await handler(baseReq({ action: 'do-something-weird' }) as any, {} as any);

    expect(res.status).toBe(400);
  });
});
