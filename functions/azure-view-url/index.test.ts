import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  return {
    mockAuthenticate: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/sas', () => ({
  generateSasToken: vi.fn(() => 'sp=r&sig=fake'),
  buildBlobUrl: vi.fn(
    (acct: string, container: string, blob: string, token: string) =>
      `https://${acct}.blob.core.windows.net/${container}/${blob}?${token}`,
  ),
}));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => ({ blobPath: 'videos/x.mp4' }),
};

describe('azure-view-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
    process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.from('testkey').toString('base64');
    process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'learner@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('returns 401 when getProfile returns null', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when blobPath is missing', async () => {
    const req = {
      method: 'POST',
      headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
      json: async () => ({}),
    };

    const res = await handler(req as any, {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'blobPath is required' });
  });

  it('returns 403 when canAccessAsset returns false; uses profile.id not oid', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Access denied' });

    // SECURITY PIN: access check must use profile.id ('p1'), not raw oid ('oid-1')
    const accessCall = mockQueryOne.mock.calls.find(c => (c[0] as string).includes('can_access'));
    expect(accessCall).toBeDefined();
    expect(accessCall![1]).toEqual(['p1', 'videos/x.mp4']);
  });

  it('access SQL matches all three lesson asset columns (issue #14: video blobs live in azure_blob_path)', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: true });

    await handler(baseReq as any, {} as any);

    // LESSON-BRANCH PARITY PIN vs public.can_user_access_lms_asset (migration/azure/
    // 01-schema.sql): a video lesson's path is stored in azure_blob_path
    // (video_storage_path is the legacy Supabase column) — matching only the other
    // two 403s every video blob. The RPC's thumbnail branch is deliberately not
    // ported here (no caller sends thumbnails to this endpoint) — see issue #60.
    const accessCall = mockQueryOne.mock.calls.find(c => (c[0] as string).includes('can_access'));
    expect(accessCall).toBeDefined();
    const sql = accessCall![0] as string;
    expect(sql).toContain('l.video_storage_path = $2');
    expect(sql).toContain('l.document_storage_path = $2');
    expect(sql).toContain('l.azure_blob_path = $2');
  });

  it('returns 200 with viewUrl on happy member path (EXISTS true)', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: true });

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('viewUrl');
    expect(body.viewUrl).toContain('testaccount.blob.core.windows.net');
    expect(body.viewUrl).toContain('lms-videos');
    expect(body.viewUrl).toContain('videos/x.mp4');
  });

  it('platform-admin bypass: skips canAccessAsset SQL entirely; returns 200', async () => {
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('viewUrl');

    // SECURITY: no access-check SQL executed at all
    const allQueryOneCalls = mockQueryOne.mock.calls.map(c => c[0] as string);
    expect(allQueryOneCalls.some(sql => sql.includes('can_access'))).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('regression pin: no SQL contains FROM profiles WHERE id =', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: true });

    await handler(baseReq as any, {} as any);

    const allSqls = mockQueryOne.mock.calls.map(c => c[0] as string);
    for (const sql of allSqls) {
      expect(sql).not.toContain('FROM profiles WHERE id =');
    }
  });

  it('responds to OPTIONS preflight', async () => {
    const req = {
      method: 'OPTIONS',
      headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : null) },
      json: async () => ({}),
    };

    const res = await handler(req as any, {} as any);

    expect(res.status).toBe(204);
  });
});
