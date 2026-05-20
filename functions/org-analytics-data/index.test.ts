import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', email: 'admin@test.com' }),
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
  json: async () => ({ orgId: 'org-uuid' }),
};

describe('org-analytics-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for users without access', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns members, enrollments, quizAttempts, and org for authorized user', async () => {
    const members = [{ id: 'mem-1', full_name: 'Alice' }];
    const enrollments = [{ id: 'enr-1', course_id: 'c-1' }];
    const quizAttempts = [{ id: 'qa-1', score: 80 }];
    const org = { id: 'org-uuid', name: 'Test Org' };

    mockQueryOne.mockResolvedValueOnce({ can_access: true }); // auth check
    // Promise.all: members, enrollments, quizAttempts (query), org (queryOne)
    mockQuery.mockResolvedValueOnce(members);
    mockQuery.mockResolvedValueOnce(enrollments);
    mockQuery.mockResolvedValueOnce(quizAttempts);
    mockQueryOne.mockResolvedValueOnce(org);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.members).toHaveLength(1);
    expect(body.enrollments).toHaveLength(1);
    expect(body.quizAttempts).toHaveLength(1);
    expect(body.org.name).toBe('Test Org');
  });
});
