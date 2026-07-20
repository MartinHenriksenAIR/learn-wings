import { describe, it, expect, vi, beforeEach } from 'vitest';

// #180 — comment author payload must carry avatar_url.
const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsActiveMember, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: mockIsOrgAdmin }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('community-comments avatar-payload (#180)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
  });

  it('joins avatar_url into the comment author profile payload', async () => {
    // 1st query: the post visibility lookup; 2nd query: the comments themselves.
    mockQuery.mockResolvedValueOnce([{ scope: 'global', org_id: null }]);
    mockQuery.mockResolvedValueOnce([{ id: 'c1', content: 'hi', profile: { id: 'a1', full_name: 'Ann', avatar_url: 'avatars/a1.png' } }]);

    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);

    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("'avatar_url', pr.avatar_url");
    expect(JSON.parse(res.body as string).comments[0].profile.avatar_url).toBe('avatars/a1.png');
  });
});
