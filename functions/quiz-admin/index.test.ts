import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const validBody = { lessonId: 'lesson-1' };

const fakeQuiz = { id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 70 };
const fakeQ1 = { id: 'q1', quiz_id: 'quiz-1', question_text: 'What is 2+2?', sort_order: 0 };
const fakeQ2 = { id: 'q2', quiz_id: 'quiz-1', question_text: 'Name a color', sort_order: 1 };
const fakeOpts = [
  { id: 'o1', question_id: 'q1', option_text: '3', is_correct: false, sort_order: 0 },
  { id: 'o2', question_id: 'q1', option_text: '4', is_correct: true, sort_order: 1 },
];

describe('quiz-admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 for non-platform-admin', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when lessonId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is empty string', async () => {
    const res = await handler(baseReq({ lessonId: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is not a string', async () => {
    const res = await handler(baseReq({ lessonId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 200 {quiz: null, questions: []} when no quiz exists — no further queries', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ quiz: null, questions: [] });
    // Only the quiz queryOne should have run; no questions/options queries
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('happy path: 2 questions, options grouped correctly with is_correct included', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeQuiz);
    mockQuery
      .mockResolvedValueOnce([fakeQ1, fakeQ2])  // questions
      .mockResolvedValueOnce(fakeOpts);           // options (q2 has none)

    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body as string);
    expect(body.quiz).toEqual(fakeQuiz);
    expect(body.questions).toHaveLength(2);

    // q1 gets its 2 options with is_correct
    const q1 = body.questions.find((q: any) => q.id === 'q1');
    expect(q1.options).toHaveLength(2);
    expect(q1.options[0]).toMatchObject({ id: 'o1', is_correct: false });
    expect(q1.options[1]).toMatchObject({ id: 'o2', is_correct: true });

    // q2 gets empty options array
    const q2 = body.questions.find((q: any) => q.id === 'q2');
    expect(q2.options).toHaveLength(0);
  });

  it('happy path: quiz fetch uses correct SQL and options query uses JOIN on quiz_id', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeQuiz);
    // Dispatch by SQL so the test is order-agnostic with respect to Promise.all parallelism
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('quiz_options')) return Promise.resolve([fakeOpts[0], fakeOpts[1]]);
      return Promise.resolve([fakeQ1]); // quiz_questions query
    });

    await handler(baseReq(validBody), {} as any);

    // Quiz queryOne — serial gate, unaffected by Promise.all
    const [quizSql, quizParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(quizSql).toContain('quizzes');
    expect(quizSql).toContain('lesson_id = $1');
    expect(quizParams).toEqual(['lesson-1']);

    const allCalls = mockQuery.mock.calls as [string, unknown[]][];

    // Questions query — order-agnostic lookup
    const questionsCall = allCalls.find(([sql]) => sql.includes('quiz_questions') && !sql.includes('quiz_options'));
    expect(questionsCall).toBeDefined();
    const [qSql, qParams] = questionsCall!;
    expect(qSql).toContain('quiz_questions');
    expect(qSql).toContain('ORDER BY sort_order');
    expect(qParams).toContain('quiz-1');

    // Options query — must use JOIN not ANY to avoid N+1; must include is_correct
    const optionsCall = allCalls.find(([sql]) => sql.includes('quiz_options'));
    expect(optionsCall).toBeDefined();
    const [optSql, optParams] = optionsCall!;
    expect(optSql).toContain('quiz_options');
    expect(optSql).toContain('is_correct');
    expect(optSql).toContain('quiz_questions');
    expect(optSql).toContain('quiz_id');
    expect(optParams).toContain('quiz-1');
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'db connection failed' });
  });
});
