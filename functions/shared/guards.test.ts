import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockGetProfile: vi.fn(),
  };
});
vi.mock('./auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('./profile', () => ({ getProfile: mockGetProfile }));

import { requirePlatformAdmin } from './guards';

const origin = 'https://ai-uddannelse.dk';
const req = {
  headers: { get: (k: string) => (k === 'origin' ? origin : 'Bearer tok') },
} as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

describe('requirePlatformAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
  });

  it('happy path: returns ok:true with the caller profile', async () => {
    const gate = await requirePlatformAdmin(req, origin);
    expect(gate).toEqual({ ok: true, profile: adminProfile });
    expect(mockAuthenticate).toHaveBeenCalledWith(req);
    expect(mockGetProfile).toHaveBeenCalledWith({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
  });

  it('returns a 401 response when authenticate rejects with AuthError', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const gate = await requirePlatformAdmin(req, origin);
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error('expected ok:false');
    expect(gate.response.status).toBe(401);
    expect(JSON.parse(gate.response.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('rethrows non-AuthError failures so the endpoint catch produces its 500', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('db connection failed'));
    await expect(requirePlatformAdmin(req, origin)).rejects.toThrow('db connection failed');
  });

  it('returns a 401 Profile not found response when the profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const gate = await requirePlatformAdmin(req, origin);
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error('expected ok:false');
    expect(gate.response.status).toBe(401);
    expect(JSON.parse(gate.response.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns a 403 Forbidden response for a non-platform-admin', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const gate = await requirePlatformAdmin(req, origin);
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error('expected ok:false');
    expect(gate.response.status).toBe(403);
    expect(JSON.parse(gate.response.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('uses the custom forbiddenError message when provided', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const gate = await requirePlatformAdmin(req, origin, {
      forbiddenError: 'Only platform admins can upload videos',
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error('expected ok:false');
    expect(gate.response.status).toBe(403);
    expect(JSON.parse(gate.response.body as string)).toEqual({
      error: 'Only platform admins can upload videos',
    });
  });

  it('sets CORS headers on the denial responses', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const gate = await requirePlatformAdmin(req, origin);
    if (gate.ok) throw new Error('expected ok:false');
    expect((gate.response.headers as Record<string, string>)['Access-Control-Allow-Origin']).toBe(origin);
  });
});
