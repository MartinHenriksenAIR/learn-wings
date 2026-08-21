import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate,
  MockAuthError,
  mockGetProfile,
  mockDeleteBlob,
  mockIsBlobReleasable,
  mockVerifyReleaseToken,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockGetProfile: vi.fn(),
    mockDeleteBlob: vi.fn(),
    mockIsBlobReleasable: vi.fn(),
    mockVerifyReleaseToken: vi.fn(),
  };
});

vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/blob-ownership', () => ({ isBlobReleasable: mockIsBlobReleasable }));
vi.mock('../shared/release-token', () => ({ verifyReleaseToken: mockVerifyReleaseToken }));
vi.mock('../shared/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/blob')>()),
  deleteBlob: mockDeleteBlob,
}));

process.env.ALLOWED_ORIGINS = 'https://ai-uddannelse.dk';

import { default as handler } from './index';

const AVATAR = 'avatars/11111111-1111-1111-1111-111111111111.png';

const call = (body: unknown) => handler(
  {
    method: 'POST',
    headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
    json: async () => body,
  } as any,
  {} as any,
);

const bodyOf = (res: { body?: unknown }) => JSON.parse(res.body as string);

describe('blob-release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'user@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockVerifyReleaseToken.mockReturnValue(true);
    mockIsBlobReleasable.mockResolvedValue(true);
    mockDeleteBlob.mockResolvedValue(true);
  });

  it('releases an unreferenced blob the caller minted', async () => {
    const res = await call({ blobPath: AVATAR, releaseToken: 'tok' });

    expect(res.status).toBe(200);
    expect(bodyOf(res)).toEqual({ released: true });
    expect(mockDeleteBlob).toHaveBeenCalledWith(AVATAR);
  });

  it('passes the family derived from the path, not one the caller supplies', async () => {
    await call({ blobPath: AVATAR, releaseToken: 'tok', family: 'lms' });
    expect(mockIsBlobReleasable).toHaveBeenCalledWith(AVATAR, 'avatar');

    await call({ blobPath: 'org-logos/acme.png', releaseToken: 'tok' });
    expect(mockIsBlobReleasable).toHaveBeenLastCalledWith('org-logos/acme.png', 'org-logo');

    await call({ blobPath: 'documents/handbook.pdf', releaseToken: 'tok' });
    expect(mockIsBlobReleasable).toHaveBeenLastCalledWith('documents/handbook.pdf', 'lms');
  });

  it('leaves a blob a row now references — the save won the race', async () => {
    mockIsBlobReleasable.mockResolvedValueOnce(false);

    const res = await call({ blobPath: AVATAR, releaseToken: 'tok' });

    expect(res.status).toBe(200);
    expect(bodyOf(res)).toEqual({ released: false });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('reports released:false when storage refuses the delete', async () => {
    mockDeleteBlob.mockResolvedValueOnce(false);

    expect(bodyOf(await call({ blobPath: AVATAR, releaseToken: 'tok' }))).toEqual({ released: false });
  });

  it('returns 403 when the token does not authorize this path for this caller', async () => {
    mockVerifyReleaseToken.mockReturnValueOnce(false);

    const res = await call({ blobPath: AVATAR, releaseToken: 'forged' });

    expect(res.status).toBe(403);
    expect(bodyOf(res)).toEqual({ error: 'Forbidden' });
    expect(mockIsBlobReleasable).not.toHaveBeenCalled();
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('verifies the token against the caller\'s profile id', async () => {
    await call({ blobPath: AVATAR, releaseToken: 'tok' });
    expect(mockVerifyReleaseToken).toHaveBeenCalledWith('tok', AVATAR, 'p1');
  });

  it('checks the token before the path shape — a forged token learns nothing about paths', async () => {
    mockVerifyReleaseToken.mockReturnValueOnce(false);

    const res = await call({ blobPath: 'https://evil.example.com/x.png', releaseToken: 'forged' });

    expect(res.status).toBe(403);
  });

  it.each([
    ['an absolute URL', 'https://cdn.example.com/logo.png'],
    ['a traversal attempt', 'avatars/../lessons/secret.mp4'],
    ['a nested branding path', 'avatars/sub/deep.png'],
  ])('returns 400 for %s, deleting nothing', async (_label, blobPath) => {
    const res = await call({ blobPath, releaseToken: 'tok' });

    expect(res.status).toBe(400);
    expect(bodyOf(res)).toEqual({ error: 'Invalid upload path' });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it.each([
    ['blobPath missing', { releaseToken: 'tok' }, 'blobPath is required'],
    ['blobPath empty', { blobPath: '', releaseToken: 'tok' }, 'blobPath is required'],
    ['blobPath not a string', { blobPath: 42, releaseToken: 'tok' }, 'blobPath is required'],
    ['releaseToken missing', { blobPath: AVATAR }, 'releaseToken is required'],
    ['releaseToken empty', { blobPath: AVATAR, releaseToken: '' }, 'releaseToken is required'],
    ['releaseToken not a string', { blobPath: AVATAR, releaseToken: 1 }, 'releaseToken is required'],
  ])('returns 400 when %s', async (_label, body, error) => {
    const res = await call(body);

    expect(res.status).toBe(400);
    expect(bodyOf(res)).toEqual({ error });
    expect(mockVerifyReleaseToken).not.toHaveBeenCalled();
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('returns 401 when the caller has no profile', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await call({ blobPath: AVATAR, releaseToken: 'tok' });

    expect(res.status).toBe(401);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing oid or tid claims'));

    const res = await call({ blobPath: AVATAR, releaseToken: 'tok' });

    expect(res.status).toBe(401);
    expect(bodyOf(res)).toEqual({ error: 'Missing oid or tid claims' });
  });

  it('returns a generic 500 when the reference check throws', async () => {
    mockIsBlobReleasable.mockRejectedValueOnce(new Error('connection refused to pg-prod'));
    const ctx = { error: vi.fn() };

    const res = await handler(
      {
        method: 'POST',
        headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
        json: async () => ({ blobPath: AVATAR, releaseToken: 'tok' }),
      } as any,
      ctx as any,
    );

    expect(res.status).toBe(500);
    expect(bodyOf(res)).toEqual({ error: 'Internal server error' });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });
});
