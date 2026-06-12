import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'admin-uuid', email: 'admin@test.com' }),
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
  json: async () => ({ quizId: 'quiz-uuid' }),
};

describe('quiz-options-admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-admin users', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns options including is_correct for platform admins', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([
      { id: 'opt-1', option_text: 'Answer A', is_correct: true, sort_order: 1, question_id: 'q-1' },
      { id: 'opt-2', option_text: 'Answer B', is_correct: false, sort_order: 2, question_id: 'q-1' },
    ]);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].is_correct).toBe(true);
    expect(body[1].is_correct).toBe(false);
  });
});
