import { describe, it, expect, vi } from 'vitest';

vi.mock('jwks-rsa', () => ({
  default: () => ({
    getSigningKey: (_kid: string, cb: (err: Error | null, key?: any) => void) => {
      cb(null, { getPublicKey: () => 'mock-public-key' });
    },
  }),
}));

const VALID_ISSUER = 'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0';

// Mirror jsonwebtoken's real class hierarchy: TokenExpiredError/NotBeforeError extend
// JsonWebTokenError, so the production `instanceof JsonWebTokenError` classification covers all three.
// Declared via vi.hoisted so they exist when the (hoisted) vi.mock factory below runs.
const { MockJsonWebTokenError, MockTokenExpiredError } = vi.hoisted(() => {
  class MockJsonWebTokenError extends Error {
    constructor(message: string) { super(message); this.name = 'JsonWebTokenError'; }
  }
  class MockTokenExpiredError extends MockJsonWebTokenError {
    constructor(message: string) { super(message); this.name = 'TokenExpiredError'; }
  }
  return { MockJsonWebTokenError, MockTokenExpiredError };
});

vi.mock('jsonwebtoken', () => ({
  JsonWebTokenError: MockJsonWebTokenError,
  TokenExpiredError: MockTokenExpiredError,
  verify: (_token: string, _getKey: unknown, _opts: unknown, cb: (err: Error | null, payload?: unknown) => void) => {
    const parts = _token.split('.');
    if (parts.length !== 3) return cb(new MockJsonWebTokenError('invalid token'));
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      // A genuine jsonwebtoken validation failure (bad signature) → JsonWebTokenError → AuthError → 401.
      if (payload._forceError) return cb(new MockJsonWebTokenError('invalid signature'));
      // Expired token → TokenExpiredError (subclass) → still classified as AuthError → 401.
      if (payload._forceExpired) return cb(new MockTokenExpiredError('jwt expired'));
      // A signing-key TRANSPORT failure surfaced via getKey/jwks-rsa is a plain Error,
      // NOT a JsonWebTokenError → must NOT be wrapped as AuthError (so it 500s + logs, not a silent 401).
      if (payload._forceTransportError) return cb(new Error('getaddrinfo ENOTFOUND login.microsoftonline.com'));
      cb(null, payload);
    } catch {
      cb(new MockJsonWebTokenError('decode error'));
    }
  },
}));

process.env.ENTRA_CLIENT_ID = 'test-client-id';

import { authenticate, AuthError } from './auth';

function makeToken(claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.fakesig`;
}

describe('authenticate', () => {
  it('returns user from valid Entra token', async () => {
    const token = makeToken({ oid: 'oid-abc', tid: '11111111-1111-1111-1111-111111111111', preferred_username: 'user@contoso.com', iss: VALID_ISSUER });
    const req = { headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null } };
    const user = await authenticate(req as any);
    expect(user.id).toBe('oid-abc');
    expect(user.tid).toBe('11111111-1111-1111-1111-111111111111');
    expect(user.email).toBe('user@contoso.com');
  });

  it('throws AuthError on missing Bearer header', async () => {
    const req = { headers: { get: () => null } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on invalid issuer pattern', async () => {
    const token = makeToken({ oid: 'o', tid: 't', iss: 'https://evil.com/token' });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on invalid signature (JsonWebTokenError → 401)', async () => {
    const token = makeToken({ _forceError: true });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on expired token (TokenExpiredError subclass → 401)', async () => {
    const token = makeToken({ _forceExpired: true });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('a JWKS transport failure is NOT wrapped as AuthError — rejects as-is so the factory 500s + logs it', async () => {
    // Simulates a signing-key fetch failure (getKey/jwks-rsa DNS/network/rate-limit against
    // login.microsoftonline.com). During an Entra outage this must NOT be a silent 401.
    const token = makeToken({ _forceTransportError: true });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.not.toBeInstanceOf(AuthError);
    // And the raw transport message is preserved (for App Insights logging), not swallowed.
    await expect(authenticate(req as any)).rejects.toThrow('getaddrinfo ENOTFOUND login.microsoftonline.com');
  });

  it('throws AuthError on missing oid or tid', async () => {
    const token = makeToken({ iss: VALID_ISSUER, email: 'x@y.com' });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });
});
