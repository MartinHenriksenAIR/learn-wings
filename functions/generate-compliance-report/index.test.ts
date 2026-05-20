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

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ orgId: 'org-uuid' }),
};

describe('generate-compliance-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for users without admin access', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns a PDF with correct content-type for authorized user', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: true }); // access check
    mockQueryOne.mockResolvedValueOnce({ name: 'Test Org' }); // org
    mockQuery.mockResolvedValueOnce([]);                      // members (empty → no departments)
    mockQuery.mockResolvedValueOnce([]);                      // course access (empty)

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect((res.headers as Record<string, string>)['Content-Disposition']).toMatch(/compliance/);
  });
});
