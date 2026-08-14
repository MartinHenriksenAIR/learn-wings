import { describe, it, expect, vi } from 'vitest';

const { MockSigningKeyNotFoundError } = vi.hoisted(() => {
  class MockSigningKeyNotFoundError extends Error {
    constructor(message: string) { super(message); this.name = 'SigningKeyNotFoundError'; }
  }
  return { MockSigningKeyNotFoundError };
});

vi.mock('jwks-rsa', () => ({
  default: () => ({
    getSigningKey: (kid: string, cb: (err: Error | null, key?: any) => void) => {
      if (kid === 'unknown-kid') return cb(new MockSigningKeyNotFoundError('Unable to find a signing key that matches'));
      cb(null, { getPublicKey: () => 'mock-public-key' });
    },
  }),
  SigningKeyNotFoundError: MockSigningKeyNotFoundError,
}));

const VALID_ISSUER = 'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0';

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
  verify: (
    _token: string,
    getKey: (header: any, keyCb: (err: Error | null, key?: string) => void) => void,
    _opts: unknown,
    cb: (err: Error | null, payload?: unknown) => void,
  ) => {
    const parts = _token.split('.');
    if (parts.length !== 3) return cb(new MockJsonWebTokenError('invalid token'));
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (payload._forceError) return cb(new MockJsonWebTokenError('invalid signature'));
      if (payload._forceExpired) return cb(new MockTokenExpiredError('jwt expired'));
      if (payload._forceTransportError) return cb(new Error('getaddrinfo ENOTFOUND login.microsoftonline.com'));
      return getKey(header, (keyErr) => {
        if (keyErr) return cb(keyErr);
        cb(null, payload);
      });
    } catch {
      cb(new MockJsonWebTokenError('decode error'));
    }
  },
}));

process.env.ENTRA_CLIENT_ID = 'test-client-id';

import { authenticate, AuthError } from './auth';

function makeToken(claims: Record<string, unknown>, kid = 'k1'): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
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

  it('throws AuthError on unknown kid (SigningKeyNotFoundError → 401, not a 500)', async () => {
    const token = makeToken({ oid: 'o', tid: 't', iss: VALID_ISSUER }, 'unknown-kid');
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('a JWKS transport failure is NOT wrapped as AuthError — rejects as-is so the factory 500s + logs it', async () => {
    const token = makeToken({ _forceTransportError: true });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.not.toBeInstanceOf(AuthError);
    await expect(authenticate(req as any)).rejects.toThrow('getaddrinfo ENOTFOUND login.microsoftonline.com');
  });

  it('throws AuthError on missing oid or tid', async () => {
    const token = makeToken({ iss: VALID_ISSUER, email: 'x@y.com' });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });
});
