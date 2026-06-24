import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({
    quiz_id: 'quiz-uuid',
    answers: { 'q1-uuid': 'opt-a', 'q2-uuid': 'opt-c' },
  }),
};

describe('grade-quiz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'learner@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('returns score and inserts quiz_attempts server-side (happy path)', async () => {
    // access check
    mockQueryOne.mockResolvedValueOnce({ has_access: true });
    // quiz metadata
    mockQueryOne.mockResolvedValueOnce({ id: 'quiz-uuid', passing_score: 70 });
    // quiz questions
    mockQuery.mockResolvedValueOnce([{ id: 'q1-uuid' }, { id: 'q2-uuid' }]);
    // correct options for q1 → user selected opt-a (correct)
    mockQuery.mockResolvedValueOnce([{ id: 'opt-a', is_correct: true }]);
    // correct options for q2 → user selected opt-c (wrong, correct is opt-b)
    mockQuery.mockResolvedValueOnce([{ id: 'opt-b', is_correct: true }]);
    // quiz_attempts insert
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(body.score).toBe(50); // 1 of 2 correct
    expect(body.passed).toBe(false);
    expect(body.correct_count).toBe(1);
    expect(body.total_questions).toBe(2);

    // SECURITY: is_correct must never appear in the response
    expect(JSON.stringify(body)).not.toContain('is_correct');

    // SECURITY PIN: access check must use profile.id ('p1'), not raw oid
    const accessCall = mockQueryOne.mock.calls.find(c => (c[0] as string).includes('has_access'));
    expect(accessCall).toBeDefined();
    expect(accessCall![1]).toEqual(['p1', 'quiz-uuid']);

    // SECURITY PIN: attempt insert must use profile.id ('p1'), not raw oid
    const insertCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('quiz_attempts'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(['p1', 'quiz-uuid', 50, false]);
  });

  it('returns 403 if user cannot access quiz (not admin, not member)', async () => {
    mockQueryOne.mockResolvedValueOnce({ has_access: false });

    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
      json: async () => ({ quiz_id: 'quiz-uuid', answers: {} }),
    };

    const res = await handler(req as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Quiz access denied' });
  });

  it('platform-admin bypass: skips access-check SQL, grading still runs', async () => {
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });

    // quiz metadata (NO access-check queryOne before this)
    mockQueryOne.mockResolvedValueOnce({ id: 'quiz-uuid', passing_score: 80 });
    // quiz questions
    mockQuery.mockResolvedValueOnce([{ id: 'q1-uuid' }]);
    // correct options for q1 → user selected opt-a (correct)
    mockQuery.mockResolvedValueOnce([{ id: 'opt-a', is_correct: true }]);
    // quiz_attempts insert
    mockQuery.mockResolvedValueOnce([]);

    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
      json: async () => ({ quiz_id: 'quiz-uuid', answers: { 'q1-uuid': 'opt-a' } }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.score).toBe(100);
    expect(body.passed).toBe(true);

    // SECURITY: no access-check SQL executed at all (queryOne only called for quiz metadata)
    const allQueryOneCalls = mockQueryOne.mock.calls.map(c => c[0] as string);
    expect(allQueryOneCalls.some(sql => sql.includes('has_access'))).toBe(false);
    // The only queryOne call should be the quiz metadata fetch
    expect(allQueryOneCalls).toHaveLength(1);
    expect(allQueryOneCalls[0]).toContain('quizzes');
  });

  it('returns 401 when getProfile returns null', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 404 when quiz not found', async () => {
    // access check passes
    mockQueryOne.mockResolvedValueOnce({ has_access: true });
    // quiz not found
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Quiz not found' });
  });

  it('scores 100 when all answers correct', async () => {
    mockQueryOne.mockResolvedValueOnce({ has_access: true });
    mockQueryOne.mockResolvedValueOnce({ id: 'quiz-uuid', passing_score: 60 });
    mockQuery.mockResolvedValueOnce([{ id: 'q1-uuid' }]);
    mockQuery.mockResolvedValueOnce([{ id: 'opt-a', is_correct: true }]);
    mockQuery.mockResolvedValueOnce([]);

    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
      json: async () => ({ quiz_id: 'quiz-uuid', answers: { 'q1-uuid': 'opt-a' } }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(body.score).toBe(100);
    expect(body.passed).toBe(true);
    expect(JSON.stringify(body)).not.toContain('is_correct');
  });

  it('returns 500 on database error with generic body, real error logged on context', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('DB connection failed'));
    const ctx = { error: vi.fn() };

    const res = await handler(baseReq as any, ctx as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string).error).toBe('Internal server error');
    expect(ctx.error).toHaveBeenCalledWith(expect.stringContaining('DB connection failed'));
  });
});
