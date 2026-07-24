import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueryOne, mockGenerateSasToken, mockBuildBlobUrl } = vi.hoisted(() => ({
  mockQueryOne: vi.fn(),
  mockGenerateSasToken: vi.fn(() => 'sp=r&sig=fake'),
  mockBuildBlobUrl: vi.fn(
    (acct: string, container: string, blob: string, token: string) =>
      `https://${acct}.blob.core.windows.net/${container}/${blob}?${token}`,
  ),
}));
vi.mock('./db', () => ({ queryOne: mockQueryOne }));
vi.mock('./sas', () => ({
  generateSasToken: mockGenerateSasToken,
  buildBlobUrl: mockBuildBlobUrl,
}));

import { canAccessLmsAsset, CAN_ACCESS_LMS_ASSET_SQL, mintLmsAssetUrl } from './lms-asset';
import { functionBody } from './__fixtures__/schema';

describe('canAccessLmsAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the predicate with $1 = profileId and $2 = blobPath', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: true });
    await expect(canAccessLmsAsset('p1', 'videos/x.mp4')).resolves.toBe(true);
    expect(mockQueryOne).toHaveBeenCalledWith(CAN_ACCESS_LMS_ASSET_SQL, ['p1', 'videos/x.mp4']);
  });

  it('returns false when the predicate is false, and fails closed on a missing row', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: false });
    await expect(canAccessLmsAsset('p1', 'videos/x.mp4')).resolves.toBe(false);
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(canAccessLmsAsset('p1', 'videos/x.mp4')).resolves.toBe(false);
  });

  // The four asset predicates, pinned individually.
  it('SQL pins all three lesson asset columns against $2', () => {
    expect(CAN_ACCESS_LMS_ASSET_SQL).toContain('l.video_storage_path = $2');
    expect(CAN_ACCESS_LMS_ASSET_SQL).toContain('l.document_storage_path = $2');
    expect(CAN_ACCESS_LMS_ASSET_SQL).toContain('l.azure_blob_path = $2');
  });

  it('SQL pins the thumbnail branch against $2', () => {
    expect(CAN_ACCESS_LMS_ASSET_SQL).toContain('c.thumbnail_url = $2');
  });

  it('SQL requires published course, enabled org access, and active membership in both branches', () => {
    const branches = CAN_ACCESS_LMS_ASSET_SQL.split('OR EXISTS');
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(branch).toContain('c.is_published = TRUE');
      expect(branch).toContain("oca.access = 'enabled'");
      expect(branch).toContain('om.user_id = $1');
      expect(branch).toContain("om.status = 'active'");
    }
  });

  it('does NOT embed the platform-admin check (TS short-circuit at the endpoint level)', () => {
    expect(CAN_ACCESS_LMS_ASSET_SQL).not.toContain('is_platform_admin');
    expect(CAN_ACCESS_LMS_ASSET_SQL).not.toContain('FROM profiles');
  });

  // Drift guard: every asset column the canonical SQL function compares against
  // file_path must be covered by the helper SQL. If the schema function gains a
  // column, this fails until the helper is updated.
  it('parity pin: covers every `<alias>.<col> = file_path` comparison in public.can_user_access_lms_asset', () => {
    const body = functionBody('can_user_access_lms_asset');
    const comparisons = [...body.matchAll(/(\w+\.\w+) = file_path/g)].map((m) => m[1]);
    expect(comparisons.sort()).toEqual(
      ['c.thumbnail_url', 'l.azure_blob_path', 'l.document_storage_path', 'l.video_storage_path'].sort(),
    );
    for (const ref of comparisons) {
      expect(CAN_ACCESS_LMS_ASSET_SQL).toContain(`${ref} = $2`);
    }
  });
});

/**
 * mintLmsAssetUrl — the shared core extracted in #239.
 * Thin wrappers (asset-signed-url, azure-view-url) are tested end-to-end
 * in their own index.test.ts files; this suite pins the core's own contracts.
 */
describe('mintLmsAssetUrl', () => {
  const memberProfile = { id: 'p1', is_platform_admin: false };
  const adminProfile = { id: 'p-admin', is_platform_admin: true };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
    process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.from('testkey').toString('base64');
    process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
  });

  // Validation — strict typeof check (sanctioned hardening, issue #239)
  it('returns 400 when blobPath is undefined', async () => {
    const result = await mintLmsAssetUrl(memberProfile, undefined);
    expect(result).toEqual({ ok: false, status: 400, error: 'blobPath is required' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when blobPath is an empty string', async () => {
    const result = await mintLmsAssetUrl(memberProfile, '');
    expect(result).toEqual({ ok: false, status: 400, error: 'blobPath is required' });
  });

  it('returns 400 when blobPath is a non-string value (e.g. number)', async () => {
    const result = await mintLmsAssetUrl(memberProfile, 42);
    expect(result).toEqual({ ok: false, status: 400, error: 'blobPath is required' });
  });

  // Authz gate
  it('returns 403 when access check fails for a regular member', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: false });
    const result = await mintLmsAssetUrl(memberProfile, 'videos/lesson.mp4');
    expect(result).toEqual({ ok: false, status: 403, error: 'Access denied' });
  });

  // Platform-admin short-circuit — queryOne must NOT be called
  it('skips the access check entirely for platform admins', async () => {
    const result = await mintLmsAssetUrl(adminProfile, 'videos/lesson.mp4');
    expect(result.ok).toBe(true);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  // Happy path — URL construction delegated to sas helpers
  it('returns ok:true with the SAS URL on access granted', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_access: true });
    const result = await mintLmsAssetUrl(memberProfile, 'videos/lesson.mp4');
    expect(result).toEqual({
      ok: true,
      url: 'https://testaccount.blob.core.windows.net/lms-videos/videos/lesson.mp4?sp=r&sig=fake',
    });
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      'testaccount',
      expect.any(String), // accountKey
      'lms-videos',
      'videos/lesson.mp4',
      'r',
      120,
    );
  });

  it('uses AZURE_STORAGE_CONTAINER_NAME env var, defaulting to lms-videos', async () => {
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
    mockQueryOne.mockResolvedValueOnce({ can_access: true });
    const result = await mintLmsAssetUrl(memberProfile, 'videos/lesson.mp4');
    expect(result.ok).toBe(true);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'lms-videos',
      'videos/lesson.mp4',
      'r',
      120,
    );
  });
});
