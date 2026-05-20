import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', email: 'admin@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQueryOne } = vi.hoisted(() => ({ mockQueryOne: vi.fn() }));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ orgId: 'org-uuid' }),
};

describe('invitation-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-platform-admin users', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns linkId when an active invitation link exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true }); // admin check
    mockQueryOne.mockResolvedValueOnce({ id: 'link-uuid-123' });     // active link

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.linkId).toBe('link-uuid-123');
  });

  it('returns null linkId when no active link exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true }); // admin check
    mockQueryOne.mockResolvedValueOnce(null);                        // no active link

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.linkId).toBeNull();
  });
});
