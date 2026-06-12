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

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('quiz-by-lesson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  // 1. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 lessonId missing
  it('returns 400 when lessonId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is not a string', async () => {
    const res = await handler(baseReq({ lessonId: 42 }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is empty string', async () => {
    const res = await handler(baseReq({ lessonId: '' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  // 4. 403 when access EXISTS returns ok:false
  it('returns 403 when access check fails and uses correct SQL params', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // access check

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Quiz access denied' });

    const [_sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['p1', 'lesson-1']);
  });

  // 5. Happy path (member)
  it('returns 200 with grouped options on happy path', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ ok: true }) // access check
      .mockResolvedValueOnce({ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 70 }); // quiz

    const questions = [
      { id: 'q1', quiz_id: 'quiz-1', question_text: 'Question 1', sort_order: 1 },
      { id: 'q2', quiz_id: 'quiz-1', question_text: 'Question 2', sort_order: 2 },
    ];
    // Options returned from DB ordered by sort_order across all questions: q1-opt1, q1-opt2, q2-opt1, q2-opt2
    const options = [
      { id: 'o1', question_id: 'q1', option_text: 'A', sort_order: 1 },
      { id: 'o2', question_id: 'q1', option_text: 'B', sort_order: 2 },
      { id: 'o3', question_id: 'q2', option_text: 'C', sort_order: 1 },
      { id: 'o4', question_id: 'q2', option_text: 'D', sort_order: 2 },
    ];
    mockQuery
      .mockResolvedValueOnce(questions)  // quiz_questions
      .mockResolvedValueOnce(options);   // quiz_options

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);

    expect(body.quiz).toEqual({ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 70 });
    expect(body.questions).toHaveLength(2);

    // q1 options
    expect(body.questions[0].id).toBe('q1');
    expect(body.questions[0].options).toHaveLength(2);
    expect(body.questions[0].options[0].id).toBe('o1');
    expect(body.questions[0].options[1].id).toBe('o2');

    // q2 options
    expect(body.questions[1].id).toBe('q2');
    expect(body.questions[1].options).toHaveLength(2);
    expect(body.questions[1].options[0].id).toBe('o3');
    expect(body.questions[1].options[1].id).toBe('o4');

    // Assert options query used ANY($1::uuid[]) with correct question ids
    const [optionsSql, optionsParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(optionsSql).toContain('ANY($1::uuid[])');
    expect(optionsParams).toEqual([['q1', 'q2']]);
  });

  // 6. SECURITY: is_correct never in SQL or response
  it('SECURITY: is_correct never appears in any SQL or in the response body', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 70 });

    const questions = [
      { id: 'q1', quiz_id: 'quiz-1', question_text: 'Q1', sort_order: 1 },
    ];
    const options = [
      { id: 'o1', question_id: 'q1', option_text: 'Opt A', sort_order: 1 },
    ];
    mockQuery
      .mockResolvedValueOnce(questions)
      .mockResolvedValueOnce(options);

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    // Collect all SQL strings passed to query/queryOne
    const allQueryOneSqls = mockQueryOne.mock.calls.map(([sql]: [string]) => sql);
    const allQuerySqls = mockQuery.mock.calls.map(([sql]: [string]) => sql);
    for (const sql of [...allQueryOneSqls, ...allQuerySqls]) {
      expect(sql).not.toContain('is_correct');
    }

    // Response body must not contain is_correct
    expect(res.body as string).not.toContain('is_correct');
    expect(JSON.stringify(JSON.parse(res.body as string))).not.toContain('is_correct');
  });

  // 7. Lesson without quiz: quiz queryOne returns null → 200 { quiz: null, questions: [] }
  it('returns 200 with quiz:null when lesson has no quiz', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ ok: true }) // access check
      .mockResolvedValueOnce(null);         // no quiz

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ quiz: null, questions: [] });

    // No quiz_questions or quiz_options queries should have run
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // 8. Quiz with zero questions → no options query
  it('returns 200 with empty questions array when quiz has no questions', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 70 });

    mockQuery.mockResolvedValueOnce([]); // zero questions

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.quiz).toEqual({ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 70 });
    expect(body.questions).toEqual([]);

    // Only one query call (questions), no options query
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('ANY');
  });

  // 9. Platform-admin bypass: no access EXISTS SQL executed
  it('skips access check for platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    mockQueryOne.mockResolvedValueOnce({ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 80 }); // quiz only

    const questions = [{ id: 'q1', quiz_id: 'quiz-1', question_text: 'Q?', sort_order: 1 }];
    const options = [{ id: 'o1', question_id: 'q1', option_text: 'Yes', sort_order: 1 }];
    mockQuery
      .mockResolvedValueOnce(questions)
      .mockResolvedValueOnce(options);

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    expect(res.status).toBe(200);

    // queryOne should only have been called once (for quiz), not for the access EXISTS check
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('quizzes');
    expect(sql).not.toContain('EXISTS');
  });

  // 10. 500 db error
  it('returns 500 on db error', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: true }); // access
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused')); // quiz lookup fails

    const res = await handler(baseReq({ lessonId: 'lesson-1' }), {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
