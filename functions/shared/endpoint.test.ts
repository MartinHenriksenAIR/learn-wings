import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockGetProfile, mockIsOrgAdmin, mockIsActiveMember, mockAppHttp } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockGetProfile: vi.fn(),
    mockIsOrgAdmin: vi.fn(),
    mockIsActiveMember: vi.fn(),
    mockAppHttp: vi.fn(),
  };
});
// Mocked HERE ONLY (endpoint.ts calls app.http at factory time) so registration is assertable.
vi.mock('@azure/functions', () => ({ app: { http: mockAppHttp } }));
vi.mock('./auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('./profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: mockIsActiveMember,
  isOrgAdmin: mockIsOrgAdmin,
  isOrgAdminOfAny: vi.fn(),
}));
// ./cors and ./errors deliberately NOT mocked — they run real, as in every endpoint test.

import { endpoint, adminEndpoint, Reply } from './endpoint';
import type { AuthedCtx } from './endpoint';

const ORIGIN = 'https://ai-uddannelse.dk';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? ORIGIN : 'Bearer tok') },
  json: async () => body,
}) as any;

const testUser = { id: 'oid-1', tid: 'tid-1', email: 'u@x.com' };
const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const ok = vi.fn(async (ctx: AuthedCtx) => ctx.reply(200, { ok: true }));

describe('endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue(testUser);
    mockGetProfile.mockResolvedValue(nonAdminProfile);
  });

  it('handles OPTIONS preflight: 204, CORS headers, NO body (undici landmine)', async () => {
    const handler = endpoint('t-options', ok);
    const req = { method: 'OPTIONS', headers: { get: () => ORIGIN } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
    expect((res.headers as Record<string, string>)['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(res.body).toBeUndefined();
  });

  it('OPTIONS branch wins over auth: authenticate never called for preflight', async () => {
    const handler = endpoint('t-options-order', ok);
    const req = { method: 'OPTIONS', headers: { get: () => ORIGIN } } as any;
    await handler(req, {} as any);
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(ok).not.toHaveBeenCalled();
  });

  it('returns 401 when authenticate rejects with AuthError', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const handler = endpoint('t-auth-401', ok);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
    expect(ok).not.toHaveBeenCalled();
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const handler = endpoint('t-profile-401', ok);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
    expect(ok).not.toHaveBeenCalled();
  });

  it('run receives ctx with resolved user/profile/origin/req/context; reply renders CORS JSON', async () => {
    const handler = endpoint('t-ctx', ok);
    const req = baseReq({});
    const invocation = {} as any;
    const res = await handler(req, invocation);
    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    const ctx = ok.mock.calls[0][0];
    expect(ctx.user).toEqual(testUser);
    expect(ctx.profile).toEqual(nonAdminProfile);
    expect(ctx.origin).toBe(ORIGIN);
    expect(ctx.req).toBe(req);
    expect(ctx.context).toBe(invocation);
  });

  it('AuthError thrown from INSIDE run → 401 (live-binding instanceof)', async () => {
    const run = vi.fn(async () => { throw new MockAuthError('Token expired mid-flight'); });
    const handler = endpoint('t-run-autherror', run as any);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Token expired mid-flight' });
  });

  it('generic Error thrown from run → constant 500 and context.error logs the original message', async () => {
    const run = vi.fn(async () => { throw new Error('db exploded'); });
    const handler = endpoint('t-run-500', run as any);
    const ctxError = vi.fn();
    const res = await handler(baseReq({}), { error: ctxError } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
    expect(ctxError).toHaveBeenCalledTimes(1);
    expect(String(ctxError.mock.calls[0][0])).toContain('db exploded');
  });

  it('non-Error throw from run (string) → constant 500 and context.error still logs', async () => {
    const run = vi.fn(async () => { throw 'boom'; });
    const handler = endpoint('t-run-nonerror-500', run as any);
    const ctxError = vi.fn();
    const res = await handler(baseReq({}), { error: ctxError } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
    expect(ctxError).toHaveBeenCalledTimes(1);
  });

  it('getProfile rejecting with a generic Error → constant 500 and context.error logs the original message', async () => {
    mockGetProfile.mockRejectedValueOnce(new Error('db down'));
    const handler = endpoint('t-profile-500', ok);
    const ctxError = vi.fn();
    const res = await handler(baseReq({}), { error: ctxError } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
    expect(ctxError).toHaveBeenCalledTimes(1);
    expect(String(ctxError.mock.calls[0][0])).toContain('db down');
    expect(ok).not.toHaveBeenCalled();
  });

  it('thrown Reply from run is rendered as-is (409 with body)', async () => {
    const run = vi.fn(async () => { throw new Reply(409, { error: 'Conflict', code: 'DUP' }); });
    const handler = endpoint('t-run-reply', run as any);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(409);
    expect((res.headers as Record<string, string>)['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Conflict', code: 'DUP' });
  });

  it('malformed JSON body: req.json() rejecting inside run → constant 500', async () => {
    const run = vi.fn(async (ctx: AuthedCtx) => {
      const body = await ctx.req.json();
      return ctx.reply(200, { body });
    });
    const req = {
      method: 'POST',
      headers: { get: (k: string) => (k === 'origin' ? ORIGIN : 'Bearer tok') },
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    } as any;
    const handler = endpoint('t-bad-json', run as any);
    const res = await handler(req, { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  it('registers with app.http: given name, POST+OPTIONS, anonymous, handler === returned handler', async () => {
    const handler = endpoint('my-endpoint', ok);
    expect(mockAppHttp).toHaveBeenCalledTimes(1);
    const [name, config] = mockAppHttp.mock.calls[0] as [string, any];
    expect(name).toBe('my-endpoint');
    expect(config.methods).toEqual(['POST', 'OPTIONS']);
    expect(config.authLevel).toBe('anonymous');
    expect(config.handler).toBe(handler);
  });

  // The two org-scoped guards share one contract (admin short-circuit, DB probe
  // with (profile.id, orgId), 403 Forbidden on denial) — asserted once for both.
  describe.each([
    { name: 'requireOrgAdmin', mock: mockIsOrgAdmin, invoke: (ctx: AuthedCtx) => ctx.requireOrgAdmin('org-1') },
    { name: 'requireActiveMember', mock: mockIsActiveMember, invoke: (ctx: AuthedCtx) => ctx.requireActiveMember('org-1') },
  ])('$name', ({ name, mock, invoke }) => {
    const run = vi.fn(async (ctx: AuthedCtx) => {
      await invoke(ctx);
      return ctx.reply(200, { ok: true });
    });

    it('platform admin resolves WITHOUT the DB probe', async () => {
      mockGetProfile.mockResolvedValueOnce(adminProfile);
      const handler = endpoint(`t-${name}-admin`, run as any);
      const res = await handler(baseReq({}), {} as any);
      expect(res.status).toBe(200);
      expect(mock).not.toHaveBeenCalled();
    });

    it('non-admin with probe true resolves; probe called with (profile.id, orgId)', async () => {
      mock.mockResolvedValueOnce(true);
      const handler = endpoint(`t-${name}-yes`, run as any);
      const res = await handler(baseReq({}), {} as any);
      expect(res.status).toBe(200);
      expect(mock).toHaveBeenCalledWith('user-1', 'org-1');
    });

    it('non-admin with probe false → 403 Forbidden (thrown Reply rendered)', async () => {
      mock.mockResolvedValueOnce(false);
      const handler = endpoint(`t-${name}-no`, run as any);
      const res = await handler(baseReq({}), {} as any);
      expect(res.status).toBe(403);
      expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    });
  });

  describe('requirePlatformAdmin', () => {
    // Different shape from the org-scoped guards: no DB probe involved — the
    // gate reads profile.is_platform_admin only (hence sync, not async).
    const run = vi.fn(async (ctx: AuthedCtx) => {
      ctx.requirePlatformAdmin();
      return ctx.reply(200, { ok: true });
    });

    it('platform admin passes and run completes', async () => {
      mockGetProfile.mockResolvedValueOnce(adminProfile);
      const handler = endpoint('t-platform-admin-ok', run as any);
      const res = await handler(baseReq({}), {} as any);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual({ ok: true });
      expect(mockIsOrgAdmin).not.toHaveBeenCalled();
      expect(mockIsActiveMember).not.toHaveBeenCalled();
    });

    it('non-admin → 403 Forbidden (thrown Reply rendered); still no DB probe', async () => {
      const handler = endpoint('t-platform-admin-no', run as any);
      const res = await handler(baseReq({}), {} as any);
      expect(res.status).toBe(403);
      expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
      expect(mockIsOrgAdmin).not.toHaveBeenCalled();
      expect(mockIsActiveMember).not.toHaveBeenCalled();
    });
  });
});

describe('adminEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue(testUser);
    mockGetProfile.mockResolvedValue(adminProfile);
  });

  it('platform admin passes the gate and run is called', async () => {
    const handler = adminEndpoint('t-admin-ok', ok);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('non-admin → 403 Forbidden and run NOT called (no opts, default message)', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const handler = adminEndpoint('t-admin-403', ok);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(ok).not.toHaveBeenCalled();
  });

  it('non-admin → 403 with custom forbiddenError (trailing opts)', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const handler = adminEndpoint('t-admin-custom', ok, { forbiddenError: 'Platform admins only' });
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Platform admins only' });
    expect(ok).not.toHaveBeenCalled();
  });

  it('gate order: the 403 wins over run — run never observes the request (no body parsing)', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const json = vi.fn(async () => ({}));
    const req = {
      method: 'POST',
      headers: { get: (k: string) => (k === 'origin' ? ORIGIN : 'Bearer tok') },
      json,
    } as any;
    const handler = adminEndpoint('t-admin-order', ok);
    const res = await handler(req, {} as any);
    expect(res.status).toBe(403);
    expect(ok).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('returns 401 (not 403) when authenticate rejects with AuthError — auth precedes the admin gate', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const handler = adminEndpoint('t-admin-auth-401', ok);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
    expect(ok).not.toHaveBeenCalled();
  });

  it('returns 401 Profile not found (not 403) when the profile is not provisioned; denial carries CORS headers', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const handler = adminEndpoint('t-admin-profile-401', ok);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
    expect((res.headers as Record<string, string>)['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(ok).not.toHaveBeenCalled();
  });

  it('non-AuthError from getProfile → constant 500 (the admin gate does not swallow infrastructure failures)', async () => {
    mockGetProfile.mockRejectedValueOnce(new Error('db connection failed'));
    const handler = adminEndpoint('t-admin-profile-500', ok);
    const ctxError = vi.fn();
    const res = await handler(baseReq({}), { error: ctxError } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
    expect(ctxError).toHaveBeenCalledTimes(1);
    expect(String(ctxError.mock.calls[0][0])).toContain('db connection failed');
    expect(ok).not.toHaveBeenCalled();
  });

  it('OPTIONS preflight wins over the admin gate (204, no auth calls)', async () => {
    const handler = adminEndpoint('t-admin-options', ok);
    const req = { method: 'OPTIONS', headers: { get: () => ORIGIN } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('registers with app.http under the given name (full config shape pinned by the endpoint() test)', async () => {
    adminEndpoint('my-admin-endpoint', ok);
    expect(mockAppHttp).toHaveBeenCalledTimes(1);
    expect(mockAppHttp.mock.calls[0][0]).toBe('my-admin-endpoint');
  });
});
