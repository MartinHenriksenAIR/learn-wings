import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'learner-uuid', email: 'learner@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../shared/db', () => ({ query: mockQuery }));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ orgId: 'org-uuid', courseId: 'course-uuid' }),
};

describe('enrollment-complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks enrollment as completed and returns success', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const updateCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('enrollments'));
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain('learner-uuid');
    expect(updateCall![1]).toContain('course-uuid');
  });
});
