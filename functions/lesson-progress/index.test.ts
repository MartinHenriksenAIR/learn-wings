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
  json: async () => ({ orgId: 'org-uuid', lessonId: 'lesson-uuid', status: 'completed' }),
};

describe('lesson-progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts lesson progress and returns success', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const upsertCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('lesson_progress'));
    expect(upsertCall).toBeDefined();
    expect(upsertCall![1]).toContain('learner-uuid');
    expect(upsertCall![1]).toContain('lesson-uuid');
  });

  it('returns 500 on database error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(500);
  });
});
