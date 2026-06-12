import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockWithTransaction, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockWithTransaction: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: mockWithTransaction, getDb: vi.fn() }));
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

const validBody = {
  lessonId: 'lesson-1',
  passingScore: 70,
  questions: [
    {
      questionText: 'What is 2+2?',
      sortOrder: 0,
      options: [
        { optionText: '3', isCorrect: false },
        { optionText: '4', isCorrect: true },
      ],
    },
  ],
};

describe('quiz-admin-save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
  });

  // ── Auth & preflight ─────────────────────────────────────────────────────────

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

  // ── Validation: lessonId ─────────────────────────────────────────────────────

  it('returns 400 when lessonId is missing', async () => {
    const { lessonId: _l, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, lessonId: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, lessonId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  // ── Validation: passingScore ────────────────────────────────────────────────

  it('returns 400 when passingScore is a float', async () => {
    const res = await handler(baseReq({ ...validBody, passingScore: 70.5 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'passingScore must be an integer between 0 and 100' });
  });

  it('returns 400 when passingScore is -1', async () => {
    const res = await handler(baseReq({ ...validBody, passingScore: -1 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'passingScore must be an integer between 0 and 100' });
  });

  it('returns 400 when passingScore is 101', async () => {
    const res = await handler(baseReq({ ...validBody, passingScore: 101 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'passingScore must be an integer between 0 and 100' });
  });

  it('returns 400 when passingScore is a string', async () => {
    const res = await handler(baseReq({ ...validBody, passingScore: '70' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'passingScore must be an integer between 0 and 100' });
  });

  it('returns 400 when passingScore is missing', async () => {
    const { passingScore: _p, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'passingScore must be an integer between 0 and 100' });
  });

  it('accepts passingScore of 0', async () => {
    mockWithTransaction.mockImplementationOnce(async (cb: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 0 }] }) };
      return cb(client);
    });
    const res = await handler(baseReq({ ...validBody, passingScore: 0 }), {} as any);
    expect(res.status).toBe(200);
  });

  it('accepts passingScore of 100', async () => {
    mockWithTransaction.mockImplementationOnce(async (cb: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 100 }] }) };
      return cb(client);
    });
    const res = await handler(baseReq({ ...validBody, passingScore: 100 }), {} as any);
    expect(res.status).toBe(200);
  });

  // ── Validation: questions ────────────────────────────────────────────────────

  it('returns 400 when questions is missing', async () => {
    const { questions: _q, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'At least one question is required' });
  });

  it('returns 400 when questions is not an array', async () => {
    const res = await handler(baseReq({ ...validBody, questions: 'oops' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'At least one question is required' });
  });

  it('returns 400 when questions array is empty', async () => {
    const res = await handler(baseReq({ ...validBody, questions: [] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'At least one question is required' });
  });

  // ── Validation: per-question ─────────────────────────────────────────────────

  it('returns 400 when questionText is empty string', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{ ...validBody.questions[0], questionText: '   ' }],
    }), {} as any);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error).toContain('questionText');
  });

  it('returns 400 when questionText is not a string', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{ ...validBody.questions[0], questionText: 99 }],
    }), {} as any);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error).toContain('questionText');
  });

  it('returns 400 when sortOrder is not an integer', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{ ...validBody.questions[0], sortOrder: 1.5 }],
    }), {} as any);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error).toContain('sortOrder');
  });

  it('returns 400 when sortOrder is a string', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{ ...validBody.questions[0], sortOrder: '0' }],
    }), {} as any);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error).toContain('sortOrder');
  });

  it('returns 400 when options has fewer than 2 entries', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{ ...validBody.questions[0], options: [{ optionText: 'Only one', isCorrect: true }] }],
    }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Each question needs at least 2 options' });
  });

  it('returns 400 when no option has isCorrect true', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{
        ...validBody.questions[0],
        options: [
          { optionText: 'A', isCorrect: false },
          { optionText: 'B', isCorrect: false },
        ],
      }],
    }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Each question needs a correct answer' });
  });

  it('returns 400 when optionText is empty string', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{
        ...validBody.questions[0],
        options: [
          { optionText: '', isCorrect: true },
          { optionText: 'B', isCorrect: false },
        ],
      }],
    }), {} as any);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error).toContain('optionText');
  });

  it('returns 400 when optionText is not a string', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{
        ...validBody.questions[0],
        options: [
          { optionText: 123, isCorrect: true },
          { optionText: 'B', isCorrect: false },
        ],
      }],
    }), {} as any);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error).toContain('optionText');
  });

  it('returns 400 when isCorrect is not a boolean', async () => {
    const res = await handler(baseReq({
      ...validBody,
      questions: [{
        ...validBody.questions[0],
        options: [
          { optionText: 'A', isCorrect: 'yes' },
          { optionText: 'B', isCorrect: false },
        ],
      }],
    }), {} as any);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.error).toContain('isCorrect');
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('happy path: withTransaction called, correct SQL sequence executed, 200 response', async () => {
    const mockClientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 70 }] }) // upsert
      .mockResolvedValueOnce({ rows: [] })               // DELETE questions
      .mockResolvedValueOnce({ rows: [{ id: 'q1' }] })   // INSERT question[0]
      .mockResolvedValueOnce({ rows: [] });               // INSERT options for q1

    mockWithTransaction.mockImplementationOnce(async (cb: any) => {
      const client = { query: mockClientQuery };
      return cb(client);
    });

    const body = {
      lessonId: 'lesson-1',
      passingScore: 70,
      questions: [
        {
          questionText: 'What is 2+2?',
          sortOrder: 0,
          options: [
            { optionText: '3', isCorrect: false },
            { optionText: '4', isCorrect: true },
          ],
        },
      ],
    };

    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      quiz: { id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 70 },
    });

    // Call 0: upsert — must use ON CONFLICT (lesson_id)
    const [upsertSql, upsertParams] = mockClientQuery.mock.calls[0] as [string, unknown[]];
    expect(upsertSql).toContain('ON CONFLICT');
    expect(upsertSql).toContain('lesson_id');
    expect(upsertSql).toContain('RETURNING');
    expect(upsertParams[0]).toBe('lesson-1');
    expect(upsertParams[1]).toBe(70);

    // Call 1: DELETE questions using upserted quiz id
    const [deleteSql, deleteParams] = mockClientQuery.mock.calls[1] as [string, unknown[]];
    expect(deleteSql).toContain('DELETE FROM quiz_questions');
    expect(deleteParams[0]).toBe('quiz-1');

    // Call 2: INSERT question in array order with RETURNING id
    const [qInsertSql, qInsertParams] = mockClientQuery.mock.calls[2] as [string, unknown[]];
    expect(qInsertSql).toContain('INSERT INTO quiz_questions');
    expect(qInsertSql).toContain('RETURNING id');
    expect(qInsertParams[0]).toBe('quiz-1');
    expect(qInsertParams[1]).toBe('What is 2+2?');
    expect(qInsertParams[2]).toBe(0); // sortOrder

    // Call 3: INSERT options; sort_order = array index, is_correct values correct
    const [optInsertSql, optInsertParams] = mockClientQuery.mock.calls[3] as [string, unknown[]];
    expect(optInsertSql).toContain('INSERT INTO quiz_options');
    // sort_order for first option = 0, second option = 1
    expect(optInsertParams).toContain(0); // sort_order of option[0]
    expect(optInsertParams).toContain(1); // sort_order of option[1]
    // is_correct values
    expect(optInsertParams).toContain(false);
    expect(optInsertParams).toContain(true);
  });

  it('happy path: multiple questions inserted in array order', async () => {
    const mockClientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'quiz-1', lesson_id: 'lesson-1', passing_score: 80 }] }) // upsert
      .mockResolvedValueOnce({ rows: [] })               // DELETE
      .mockResolvedValueOnce({ rows: [{ id: 'q1' }] })   // q1 insert
      .mockResolvedValueOnce({ rows: [] })               // q1 options
      .mockResolvedValueOnce({ rows: [{ id: 'q2' }] })   // q2 insert
      .mockResolvedValueOnce({ rows: [] });               // q2 options

    mockWithTransaction.mockImplementationOnce(async (cb: any) => {
      return cb({ query: mockClientQuery });
    });

    const body = {
      lessonId: 'lesson-1',
      passingScore: 80,
      questions: [
        {
          questionText: 'Q1',
          sortOrder: 0,
          options: [
            { optionText: 'A', isCorrect: true },
            { optionText: 'B', isCorrect: false },
          ],
        },
        {
          questionText: 'Q2',
          sortOrder: 1,
          options: [
            { optionText: 'X', isCorrect: false },
            { optionText: 'Y', isCorrect: true },
          ],
        },
      ],
    };

    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);

    // 6 calls total: upsert + delete + q1_insert + q1_opts + q2_insert + q2_opts
    expect(mockClientQuery).toHaveBeenCalledTimes(6);

    // q2 insert is call index 4
    const [q2InsertSql, q2InsertParams] = mockClientQuery.mock.calls[4] as [string, unknown[]];
    expect(q2InsertSql).toContain('INSERT INTO quiz_questions');
    expect(q2InsertParams[1]).toBe('Q2');
    expect(q2InsertParams[2]).toBe(1);
  });

  // ── Transaction rollback ─────────────────────────────────────────────────────

  it('returns 500 with err.message when transaction throws mid-sequence', async () => {
    mockWithTransaction.mockImplementationOnce(async (cb: any) => {
      const client = { query: vi.fn().mockRejectedValueOnce(new Error('FK violation')) };
      // Like real withTransaction: the callback's rejection propagates after rollback
      return await cb(client);
    });

    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'FK violation' });
  });

  // ── 500 on auth-level DB error ───────────────────────────────────────────────

  it('returns 500 on auth-level db error propagating err.message', async () => {
    mockWithTransaction.mockRejectedValueOnce(new Error('connection pool exhausted'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection pool exhausted' });
  });
});
