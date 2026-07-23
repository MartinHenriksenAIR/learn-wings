import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));

import handler from './index';
import { ASSESSMENT_QUESTIONS, QUESTIONNAIRE_VERSION } from '../shared/assessment-questions';

const baseReq = () => ({
  method: 'POST',
  headers: { get: () => 'https://ai-uddannelse.dk' },
  json: async () => ({}),
}) as any;

describe('assessment-questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'x' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Unauthorized'));
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when profile not found', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(401);
  });

  it('happy path: returns questions and version without points field', async () => {
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body as string);
    expect(body.version).toBe(QUESTIONNAIRE_VERSION);
    expect(body.questions).toHaveLength(ASSESSMENT_QUESTIONS.length);

    for (const [i, q] of body.questions.entries()) {
      expect(q.id).toBe(ASSESSMENT_QUESTIONS[i].id);
      expect(q.options).toEqual([...ASSESSMENT_QUESTIONS[i].options]);
      // Points must NOT be exposed to the client.
      expect(q).not.toHaveProperty('points');
    }
  });
});
