import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockGenerateSasToken, mockBuildBlobUrl } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockGenerateSasToken: vi.fn(() => 'sp=r&sig=fake'),
    mockBuildBlobUrl: vi.fn(
      (acct: string, container: string, blob: string, token: string) =>
        `https://${acct}.blob.core.windows.net/${container}/${blob}?${token}`,
    ),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/sas', () => ({
  generateSasToken: mockGenerateSasToken,
  buildBlobUrl: mockBuildBlobUrl,
}));

import handler from './index';

const baseReq = (body: unknown = { blobPath: 'videos/lesson.mp4' }) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
});

describe('asset-signed-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
    process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.from('testkey').toString('base64');
    process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'learner@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  // 1. 401 bad token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq() as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 1b. issue #104: an AuthError whose message lacks the literal "token" must
  // still map to 401 — the old substring check collapsed it to a generic 500.
  it('returns 401 when authenticate throws an AuthError with a token-less message', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing oid or tid claims'));

    const res = await handler(baseReq() as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing oid or tid claims' });
  });

  // 1c. issue #104: a non-auth error whose message merely contains "token" must
  // NOT be mistaken for a 401 and must not leak its message — generic 500.
  it('returns a generic 500 (no leak) when a non-auth error mentions "token"', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection token expired'));
    const ctx = { error: vi.fn() };

    const res = await handler(baseReq() as any, ctx as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
    expect(ctx.error).toHaveBeenCalledWith(expect.stringContaining('db connection token expired'));
  });

  // 2. 401 no profile
  it('returns 401 when profile is not found', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq() as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 missing blobPath
  it('returns 400 when blobPath is missing from body', async () => {
    const res = await handler(baseReq({}) as any, {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'blobPath is required' });
  });

  // 4. 400 empty-string blobPath
  it('returns 400 when blobPath is empty string', async () => {
    const res = await handler(baseReq({ blobPath: '' }) as any, {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'blobPath is required' });
  });

  // 5. 403 when can_access false — SQL must contain BOTH thumbnail_url and video_storage_path branches
  it('returns 403 when can_access is false; SQL covers both lesson and thumbnail branches', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: false });

    const res = await handler(baseReq({ blobPath: 'thumbnails/course.jpg' }) as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Access denied' });

    const accessCall = mockQueryOne.mock.calls.find(c => (c[0] as string).includes('can_access'));
    expect(accessCall).toBeDefined();
    const [sql, params] = accessCall as [string, unknown[]];
    // Both branches present
    expect(sql).toContain('thumbnail_url');
    expect(sql).toContain('video_storage_path');
    // Params: profileId first, blobPath second
    expect(params).toEqual(['p1', 'thumbnails/course.jpg']);
  });

  // 5b. issue #60: shared canAccessLmsAsset restores azure_blob_path to the lesson branch
  // (the exact bug class issue #14 fixed in azure-view-url — video blobs live in azure_blob_path)
  it('access SQL covers all three lesson asset columns including azure_blob_path', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: true });

    const res = await handler(baseReq({ blobPath: 'videos/lesson.mp4' }) as any, {} as any);

    expect(res.status).toBe(200);
    const accessCall = mockQueryOne.mock.calls.find(c => (c[0] as string).includes('can_access'));
    expect(accessCall).toBeDefined();
    const sql = accessCall![0] as string;
    expect(sql).toContain('l.video_storage_path = $2');
    expect(sql).toContain('l.document_storage_path = $2');
    expect(sql).toContain('l.azure_blob_path = $2');
  });

  // 6. Happy non-admin path → 200 with { url }
  it('returns 200 with url on happy member path', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: true });

    const res = await handler(baseReq({ blobPath: 'videos/lesson.mp4' }) as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('url');
    expect(body.url).toContain('testaccount.blob.core.windows.net');
    expect(body.url).toContain('lms-videos');
    expect(body.url).toContain('videos/lesson.mp4');
  });

  // 7. Platform admin bypass — queryOne NOT called → 200
  it('platform admin bypasses access check: queryOne not called, returns 200', async () => {
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ blobPath: 'videos/lesson.mp4' }) as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('url');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  // 8. 500 db error: generic body, real message logged server-side (ADR-0014)
  it('returns 500 when db throws with generic body, real error logged on context', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const ctx = { error: vi.fn() };

    const res = await handler(baseReq({ blobPath: 'videos/lesson.mp4' }) as any, ctx as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
    expect(ctx.error).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
  });
});
