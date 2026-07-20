import { describe, it, expect, vi, beforeEach } from 'vitest';

// #180 — post detail author payload must carry avatar_url.
const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsActiveMember, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: mockIsOrgAdmin }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('community-post avatar-payload (#180)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
  });

  it('joins avatar_url into the author profile payload', async () => {
    const post = { id: 'post-1', scope: 'global', org_id: null, is_hidden: false, profile: { id: 'a1', full_name: 'Ann', avatar_url: 'avatars/a1.png' } };
    mockQueryOne.mockResolvedValueOnce(post);

    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);

    expect(res.status).toBe(200);
    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'avatar_url', pr.avatar_url");
    expect(JSON.parse(res.body as string).post.profile.avatar_url).toBe('avatars/a1.png');
  });
});
