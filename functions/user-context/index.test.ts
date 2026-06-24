import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', tid: 'entra-tid-456', email: 'user@contoso.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
};

describe('user-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing profile and memberships', async () => {
    const existingProfile = { id: 'profile-uuid', full_name: 'Test User', email: 'user@contoso.com', is_platform_admin: false, avatar_url: null };
    const memberships = [{ org_id: 'org-1', role: 'member', organization: { name: 'Org One' } }];
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockQuery.mockResolvedValueOnce(memberships);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(body.profile.id).toBe('profile-uuid');
    expect(body.memberships).toHaveLength(1);
    // Should NOT have called INSERT (profile already existed)
    const insertCall = mockQueryOne.mock.calls.find(c => (c[0] as string).includes('INSERT'));
    expect(insertCall).toBeUndefined();
  });

  it('provisions a new profile on first login', async () => {
    const newProfile = { id: 'new-uuid', full_name: 'user', email: 'user@contoso.com', is_platform_admin: false, avatar_url: null };
    mockQueryOne.mockResolvedValueOnce(null);        // no existing profile
    mockQueryOne.mockResolvedValueOnce(newProfile);  // INSERT returning
    mockQuery.mockResolvedValueOnce([]);             // memberships (empty for new user)

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(body.profile.id).toBe('new-uuid');
    expect(body.memberships).toHaveLength(0);
    // Verify INSERT was called with Entra oid and tid
    const insertCall = mockQueryOne.mock.calls.find(c => (c[0] as string).includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain('entra-oid-123');
    expect(insertCall![1]).toContain('entra-tid-456');
  });

  it('returns 500 on unexpected database error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq as any, { error: vi.fn() } as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });
});
