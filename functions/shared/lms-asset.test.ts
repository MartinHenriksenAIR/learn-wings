import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueryOne } = vi.hoisted(() => ({ mockQueryOne: vi.fn() }));
vi.mock('./db', () => ({ queryOne: mockQueryOne }));

import { canAccessLmsAsset, CAN_ACCESS_LMS_ASSET_SQL } from './lms-asset';
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
