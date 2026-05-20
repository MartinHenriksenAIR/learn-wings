import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', email: 'learner@test.com' }),
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
  json: async () => ({ enrollmentId: 'enroll-uuid' }),
};

describe('generate-certificate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 if enrollment does not belong to the user', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no enrollment found for this user

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns 400 if course is not completed', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'profile-uuid', status: 'in_progress', course_id: 'c-1' });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(400);
  });

  it('returns a PDF with correct headers when enrollment is completed', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'profile-uuid', status: 'completed', course_id: 'c-1', completed_at: '2026-05-01T00:00:00Z' });
    // Promise.all: profile, course, org
    mockQueryOne.mockResolvedValueOnce({ full_name: 'Alice Smith' });
    mockQueryOne.mockResolvedValueOnce({ title: 'AI Basics' });
    mockQueryOne.mockResolvedValueOnce({ name: 'Acme Corp' });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect((res.headers as Record<string, string>)['Content-Disposition']).toMatch(/certificate/);
  });
});
