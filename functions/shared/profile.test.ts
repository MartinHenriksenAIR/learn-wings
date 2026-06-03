import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('./db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import { getProfile, isActiveMember, isOrgAdmin } from './profile';

const user = { id: 'entra-oid-abc', tid: 'entra-tid-xyz', email: 'user@contoso.com' };

describe('getProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the row from queryOne and passes [user.id, user.tid] as params with entra_oid/entra_tid SQL', async () => {
    const row = { id: 'profile-uuid', is_platform_admin: false };
    mockQueryOne.mockResolvedValueOnce(row);

    const result = await getProfile(user);

    expect(result).toEqual(row);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/entra_oid/);
    expect(sql).toMatch(/entra_tid/);
    expect(params).toEqual([user.id, user.tid]);
  });

  it('returns null when no row found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await getProfile(user);

    expect(result).toBeNull();
  });
});

describe('isActiveMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when row.ok is true', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: true });

    const result = await isActiveMember('profile-uuid', 'org-uuid');

    expect(result).toBe(true);
  });

  it('returns false when row.ok is false', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: false });

    const result = await isActiveMember('profile-uuid', 'org-uuid');

    expect(result).toBe(false);
  });

  it('returns false when queryOne returns null', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await isActiveMember('profile-uuid', 'org-uuid');

    expect(result).toBe(false);
  });
});

describe('isOrgAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when row.ok is true', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: true });

    const result = await isOrgAdmin('profile-uuid', 'org-uuid');

    expect(result).toBe(true);
  });

  it('returns false when row.ok is false', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: false });

    const result = await isOrgAdmin('profile-uuid', 'org-uuid');

    expect(result).toBe(false);
  });

  it('returns false when queryOne returns null', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await isOrgAdmin('profile-uuid', 'org-uuid');

    expect(result).toBe(false);
  });

  it('SQL contains role = \'org_admin\'', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: true });

    await isOrgAdmin('profile-uuid', 'org-uuid');

    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/role\s*=\s*'org_admin'/);
  });
});
