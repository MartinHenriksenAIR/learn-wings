import { describe, it, expect, vi } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'learner-uuid', email: 'learner@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

describe('grade-quiz', () => {
  it('returns score and inserts quiz_attempts server-side', async () => {
    // user_can_access_quiz check
    mockQueryOne.mockResolvedValueOnce({ has_access: true });
    // quiz metadata
    mockQueryOne.mockResolvedValueOnce({ id: 'quiz-uuid', passing_score: 70 });
    // quiz questions
    mockQuery.mockResolvedValueOnce([
      { id: 'q1-uuid' }, { id: 'q2-uuid' }
    ]);
    // correct options for q1 → user selected opt-a (correct)
    mockQuery.mockResolvedValueOnce([{ id: 'opt-a', is_correct: true }]);
    // correct options for q2 → user selected opt-c (wrong)
    mockQuery.mockResolvedValueOnce([{ id: 'opt-b', is_correct: true }]);
    // quiz_attempts insert
    mockQuery.mockResolvedValueOnce([]);

    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
      json: async () => ({
        quiz_id: 'quiz-uuid',
        answers: { 'q1-uuid': 'opt-a', 'q2-uuid': 'opt-c' },
      }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body);

    expect(body.score).toBe(50); // 1 of 2 correct
    expect(body.passed).toBe(false);
    expect(body.correct_count).toBe(1);
    expect(body.total_questions).toBe(2);
    // Verify quiz_attempts was inserted (last mock call)
    const insertCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('quiz_attempts'));
    expect(insertCall).toBeDefined();
  });

  it('returns 403 if user cannot access quiz', async () => {
    mockQueryOne.mockResolvedValueOnce({ has_access: false });
    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
      json: async () => ({ quiz_id: 'quiz-uuid', answers: {} }),
    };
    const res = await handler(req as any, {} as any);
    expect(res.status).toBe(403);
  });
});
