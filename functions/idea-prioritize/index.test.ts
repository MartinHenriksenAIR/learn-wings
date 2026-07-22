import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const ideaRow = { id: 'idea-1', org_id: 'org-1' };

describe('idea-prioritize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when ideaId is missing', async () => {
    const res = await handler(baseReq({ value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when value is out of range', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 4, effort: 1 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'value must be an integer 1-3 or null' });
  });

  it('returns 400 when effort is missing (undefined)', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'effort must be an integer 1-3 or null' });
  });

  it('returns 404 when idea not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ ideaId: 'idea-999', value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(404);
  });

  it('returns 403 when a plain member tries to score', async () => {
    mockQueryOne.mockResolvedValueOnce(ideaRow);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(403);
  });

  it('happy path: org admin scores (isOrgAdmin called with idea org_id; both columns set)', async () => {
    mockQueryOne.mockResolvedValueOnce(ideaRow);            // load
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { ...ideaRow, value_score: 3, effort_score: 1 };
    mockQueryOne.mockResolvedValueOnce(updated);            // UPDATE RETURNING
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: updated });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE ideas');
    expect(sql).toContain('value_score =');
    expect(sql).toContain('effort_score =');
    expect(params).toEqual([3, 1, 'idea-1']);
  });

  it('clears scores when value and effort are null', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow);
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, value_score: null, effort_score: null });
    const res = await handler(baseReq({ ideaId: 'idea-1', value: null, effort: null }), {} as any);
    expect(res.status).toBe(200);
    const [, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([null, null, 'idea-1']);
  });

  it('platform admin scores without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow);
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, value_score: 2, effort_score: 2 });
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 2, effort: 2 }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3, effort: 1 }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
