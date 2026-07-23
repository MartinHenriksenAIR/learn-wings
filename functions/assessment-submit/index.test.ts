import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockClientQuery, mockWithTransaction, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockClientQuery = vi.fn();
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockClientQuery,
    mockWithTransaction: vi.fn(async (cb: (c: { query: typeof mockClientQuery }) => unknown) =>
      cb({ query: mockClientQuery }),
    ),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: mockWithTransaction,
}));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));

import handler from './index';
import { ASSESSMENT_QUESTIONS, QUESTIONNAIRE_VERSION } from '../shared/assessment-questions';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: () => 'https://ai-uddannelse.dk' },
  json: async () => body,
}) as any;

// Build answers where every question gets a specific option index.
function uniformAnswers(idx: number): Record<string, string> {
  return Object.fromEntries(ASSESSMENT_QUESTIONS.map((q) => [q.id, q.options[idx]]));
}

// Build valid minimum answers (all index 0 → score 0).
function minAnswers(): Record<string, string> {
  return uniformAnswers(0);
}

describe('assessment-submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (cb) => cb({ query: mockClientQuery }));
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockClientQuery.mockResolvedValue({ rows: [] });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'x' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Unauthorized'));
    const res = await handler(baseReq({ answers: minAnswers() }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when profile not found', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ answers: minAnswers() }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when answers is not an object', async () => {
    const res = await handler(baseReq({ answers: 'bad' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toContain('answers must be an object');
  });

  it('returns 400 when answers is null', async () => {
    const res = await handler(baseReq({ answers: null }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when a question id is missing', async () => {
    const answers = minAnswers();
    delete answers[ASSESSMENT_QUESTIONS[0].id];
    const res = await handler(baseReq({ answers }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toContain('missing answer for');
  });

  it('returns 400 when there is an unexpected question id', async () => {
    const answers = { ...minAnswers(), 'bogus-question': 'some-value' };
    const res = await handler(baseReq({ answers }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toContain('unexpected question id');
  });

  it('returns 400 when an unknown option is submitted', async () => {
    const answers = minAnswers();
    answers[ASSESSMENT_QUESTIONS[0].id] = 'not-a-real-option';
    const res = await handler(baseReq({ answers }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toContain('unknown option');
  });

  it('happy path: all-index-1 answers → score 7, basic', async () => {
    const answers = uniformAnswers(1);
    const res = await handler(baseReq({ answers }), { error: vi.fn() } as any);
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ score: 7, level: 'basic' });

    // INSERT params: user_id, score, level, answers jsonb, version.
    const [insertSql, insertParams] = mockClientQuery.mock.calls[0] as [string, unknown[]];
    expect(insertSql).toContain('INSERT INTO assessment_attempts');
    expect(insertParams[0]).toBe('p1');
    expect(insertParams[1]).toBe(7);
    expect(insertParams[2]).toBe('basic');
    expect(insertParams[3]).toBe(JSON.stringify(answers));
    expect(insertParams[4]).toBe(QUESTIONNAIRE_VERSION);

    // UPDATE profiles params: level, user_id.
    const [updateSql, updateParams] = mockClientQuery.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain('UPDATE profiles');
    expect(updateSql).toContain('assessment_level');
    expect(updateParams).toEqual(['basic', 'p1']);
  });

  it('all-index-2 answers → score 14, intermediate', async () => {
    const answers = uniformAnswers(2);
    const res = await handler(baseReq({ answers }), { error: vi.fn() } as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.score).toBe(14);
    expect(body.level).toBe('intermediate');
  });

  it('score-8 mixed answers → intermediate', async () => {
    // 7 questions × index 1 = 7, bump one to index 2 → +1 = 8
    const answers = uniformAnswers(1);
    const firstQ = ASSESSMENT_QUESTIONS[0];
    answers[firstQ.id] = firstQ.options[2];
    const res = await handler(baseReq({ answers }), { error: vi.fn() } as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.score).toBe(8);
    expect(body.level).toBe('intermediate');
  });

  it('all-index-3 answers → score 21, advanced', async () => {
    const answers = uniformAnswers(3);
    const res = await handler(baseReq({ answers }), { error: vi.fn() } as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.score).toBe(21);
    expect(body.level).toBe('advanced');
  });
});
