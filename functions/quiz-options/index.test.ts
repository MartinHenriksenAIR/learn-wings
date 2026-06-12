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
  json: async () => ({ questionId: 'q-uuid' }),
};

describe('quiz-options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns options without is_correct for learner', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'opt-1', option_text: 'Answer A', sort_order: 1 },
      { id: 'opt-2', option_text: 'Answer B', sort_order: 2 },
    ]);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    // Critical: is_correct must never be exposed to learners
    expect(body[0]).not.toHaveProperty('is_correct');
    expect(body[1]).not.toHaveProperty('is_correct');
  });
});
