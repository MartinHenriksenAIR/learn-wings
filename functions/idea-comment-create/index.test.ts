import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const submittedIdea = {
  id: 'idea-1',
  org_id: 'org-1',
  user_id: 'p2',
  status: 'submitted',
};

// draft owned by p2 (not the caller)
const othersDraft = {
  id: 'idea-2',
  org_id: 'org-1',
  user_id: 'p2',
  status: 'draft',
};

const validBody = { ideaId: 'idea-1', content: 'Great idea!' };

const createdComment = {
  id: 'c-new',
  idea_id: 'idea-1',
  org_id: 'org-1',
  user_id: 'p1',
  content: 'Great idea!',
  parent_comment_id: null,
  profile: { id: 'p1', full_name: 'Alice' },
};

describe('idea-comment-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
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

  it('returns 400 when ideaId is missing', async () => {
    const res = await handler(baseReq({ content: 'x' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when ideaId is not a string', async () => {
    const res = await handler(baseReq({ ideaId: 1, content: 'x' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when content is missing', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when content is empty string', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', content: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when content is not a string', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', content: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when parentCommentId is provided but not a string', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', content: 'x', parentCommentId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'parentCommentId must be a string' });
  });

  it('returns 404 when idea is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // idea load
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Idea not found' });
  });

  it('returns 404 for another author\'s draft', async () => {
    mockQueryOne.mockResolvedValueOnce(othersDraft); // idea load
    const res = await handler(baseReq({ ideaId: 'idea-2', content: 'x' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Idea not found' });
  });

  it('returns 403 when caller is not a member', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when parentCommentId is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(null); // parent comment → not found
    const res = await handler(baseReq({ ...validBody, parentCommentId: 'missing-parent' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'parentCommentId must reference a comment on this idea' });
  });

  it('returns 400 when parentCommentId references a comment on a different idea', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ idea_id: 'idea-other' }); // parent on different idea
    const res = await handler(baseReq({ ...validBody, parentCommentId: 'c-other-idea' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'parentCommentId must reference a comment on this idea' });
  });

  it('happy path: creates comment with CTE, org from loaded row, parent null when absent', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(createdComment); // CTE INSERT
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comment: createdComment });

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('WITH ins AS');
    expect(sql).toContain('INSERT INTO idea_comments');
    expect(sql).toContain('JOIN profiles pr');
    // params: [ideaId, org_id-from-row, profile.id, content, parent??null]
    expect(params).toEqual(['idea-1', 'org-1', 'p1', 'Great idea!', null]);
  });

  it('happy path with valid parentCommentId: passes parent id in params', async () => {
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ idea_id: 'idea-1' }); // parent comment found on same idea
    mockQueryOne.mockResolvedValueOnce({ ...createdComment, parent_comment_id: 'c1' }); // CTE INSERT
    const res = await handler(baseReq({ ...validBody, parentCommentId: 'c1' }), {} as any);
    expect(res.status).toBe(200);

    const [sql, params] = mockQueryOne.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO idea_comments');
    expect(params).toContain('c1'); // parent comment id passed
    expect(params).toContain('org-1'); // org from loaded row
    expect(params).toContain('p1'); // profile.id
  });

  it('platform admin bypasses membership check', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(submittedIdea); // idea load
    mockQueryOne.mockResolvedValueOnce(createdComment); // CTE INSERT
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
